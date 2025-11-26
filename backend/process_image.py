#!/usr/bin/env python
import sys
import os
from PIL import Image, ImageFilter
import argparse


def usage():
    print("usage: process_image.py <input_path> <output_dir> [--threshold N] [--offset N] [--token N] [--resolution N]")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input_path', nargs='?')
    parser.add_argument('out_dir', nargs='?')
    parser.add_argument('--export-dxfs', type=str, default=None, help='Directory to read .poly.json/.text.json and write DXF files')
    parser.add_argument('--projectdir', type=str, default=None)
    parser.add_argument('--workfolder', type=str, default=None)
    parser.add_argument('--threshold', type=float, default=None)
    parser.add_argument('--offset', type=float, default=None)
    parser.add_argument('--token', type=float, default=None)
    parser.add_argument('--resolution', type=int, default=None)
    args = parser.parse_args()

    inp = args.input_path
    out = args.out_dir
    # If export-dxfs mode is used, treat the provided export-dxfs path as the directory to operate on
    if args.export_dxfs:
        export_dir = args.export_dxfs
        os.makedirs(export_dir, exist_ok=True)
        do_export_dxfs(export_dir, args.projectdir)
        sys.exit(0)
    if out:
        os.makedirs(out, exist_ok=True)

    try:
        # If a workfolder is provided, switch cwd so processing writes into project folder
        if args.workfolder:
            try:
                os.makedirs(args.workfolder, exist_ok=True)
                os.chdir(args.workfolder)
            except Exception as e:
                print('warning: could not chdir to workfolder', e)

        # If a projectdir is provided and contains a `src.processing`, prefer using it
        use_src_processing = False
        if args.projectdir:
            try:
                import sys as _sys
                _sys.path.insert(0, args.projectdir)
                # attempt to import src.processing
                import src.processing as sp  # type: ignore
                use_src_processing = True
            except Exception:
                # fall back to local processing if import fails
                use_src_processing = False

        img = Image.open(inp).convert('RGB')
        # save a copy of the original as PNG
        orig_path = os.path.join(out, 'original.png')
        img.save(orig_path)
        # If src.processing is available, prefer to call its processing pipeline
        if use_src_processing:
            try:
                import numpy as _np
                import cv2 as _cv2

                # Monkeypatch src.processing.display_image_on_canvas to write images to out dir
                def save_display(image_obj, canvas_obj, region, caption):
                    try:
                        from PIL import Image as PILImage
                        import numpy as np
                        # image_obj may be a numpy array (grayscale or BGR) or a PIL Image
                        if isinstance(image_obj, np.ndarray):
                            if image_obj.ndim == 2:
                                pil = PILImage.fromarray(image_obj).convert('L').convert('RGB')
                            else:
                                pil = PILImage.fromarray(_cv2.cvtColor(image_obj, _cv2.COLOR_BGR2RGB))
                        elif isinstance(image_obj, PILImage.Image):
                            pil = image_obj.convert('RGB')
                        else:
                            return

                        # Resize to approx the same behavior as the Qt canvas version
                        canvas_width = max(1, pil.width // 3)
                        canvas_height = max(10, pil.height - 50)
                        scale_factor = min(canvas_width / pil.width, canvas_height / pil.height)
                        if scale_factor <= 0:
                            scale_factor = 1.0
                        new_w = max(1, int(pil.width * scale_factor))
                        new_h = max(1, int(pil.height * scale_factor))
                        pil = pil.resize((new_w, new_h), PILImage.LANCZOS)

                        if region == 1:
                            name = 'original.png'
                        elif region == 2:
                            name = 'traced.png'
                        elif region == 3:
                            name = 'offset.png'
                        else:
                            name = f'region_{region}.png'

                        pil.save(os.path.join(out, name))
                    except Exception as e:
                        print('save_display failed', e)

                sp.display_image_on_canvas = save_display

                # Create dummy UI fields compatible with get_threshold_input
                class DummyEntry:
                    def __init__(self, v):
                        self._v = v
                    def text(self):
                        return str(self._v)

                class DummyConsole:
                    def setText(self, s):
                        print('console:', s)

                # prepare entries with provided args or reasonable defaults
                # Threshold default 145
                thr_val = int(args.threshold) if args.threshold is not None else 145
                # Offset and token defaults are specified in inches; convert to mm (multiply by 25.4)
                off_val = (float(args.offset) * 25.4) if args.offset is not None else (0.1 * 25.4)
                token_val = (float(args.token) * 25.4) if args.token is not None else (3.0 * 25.4)
                # Resolution default 20
                res_val = int(args.resolution) if args.resolution is not None else 20

                threshold_entry = DummyEntry(thr_val)
                offset_entry = DummyEntry(off_val)
                token_entry = DummyEntry(token_val)
                resolution_entry = DummyEntry(res_val)
                console = DummyConsole()

                # Call find_diameter which will write traced image via our save_display
                try:
                    diameter, threshold_input = sp.find_diameter(inp, None, threshold_entry, offset_entry, token_entry, resolution_entry, console)
                except TypeError:
                    # some versions expect image array; read it
                    import cv2
                    img_cv = cv2.imread(inp)
                    diameter, threshold_input = sp.find_diameter(img_cv, None, threshold_entry, offset_entry, token_entry, resolution_entry, console)

                if diameter is None:
                    print('find_diameter returned no diameter; continuing with defaults')
                    diameter = token_entry._v if hasattr(token_entry, '_v') else 2.0

                # Call find_contours which will write offset/traced outputs via save_display
                try:
                    contours, offset_image = sp.find_contours(inp, diameter, threshold_input, None, console)
                except TypeError:
                    contours, offset_image = sp.find_contours(img_cv, diameter, threshold_input, None, console)

                # Attempt to save contours as DXF using the desktop helper so behavior
                # mirrors Step 1 Picture to DXF.py. We compute the token->scale ratio
                # as token_val / diameter (token_val is in mm).
                try:
                    # derive file stem (basename without extension) to mirror desktop behavior
                    file_stem = os.path.splitext(os.path.basename(inp))[0]
                    # folder_name: if we chdir'd to workfolder earlier, use its basename
                    folder_name = os.path.basename(os.getcwd())
                    token_scale = (token_val / diameter) if diameter and diameter != 0 else (token_val)
                    # save_contours_as_dxf may return (dxf_path, gridx_size, gridy_size)
                    try:
                        # Force splitDXF=True to preserve desktop behavior (split items into separate DXFs)
                        dxf_res = sp.save_contours_as_dxf(contours, file_stem, token_scale, console, folder_name, splitDXF=True)
                    except TypeError:
                        # some versions may not accept the splitDXF kwarg; fall back to calling without it
                        try:
                            dxf_res = sp.save_contours_as_dxf(contours, file_stem, token_scale, console, folder_name)
                        except Exception as _e:
                            print('warning: save_contours_as_dxf fallback failed', _e)
                            dxf_res = None
                    if dxf_res:
                        try:
                            # dxf_res may be (dxf_path, gridx_size, gridy_size)
                            # where dxf_path can itself be a list when splitDXF=True.
                            dxf_path_raw, gridx_size, gridy_size = dxf_res
                            import json as _json
                            # Normalize to absolute paths. Support both single string and list.
                            if isinstance(dxf_path_raw, (list, tuple)):
                                dxf_paths = [os.path.abspath(p) for p in dxf_path_raw]
                                dxf_path = dxf_paths[0] if dxf_paths else None
                            else:
                                dxf_paths = [os.path.abspath(dxf_path_raw)] if dxf_path_raw else []
                                dxf_path = dxf_paths[0] if dxf_paths else None

                            meta = {
                                'dxf_path': dxf_path,
                                'dxf_paths': dxf_paths,
                                'gridx_size': gridx_size,
                                'gridy_size': gridy_size,
                            }
                            with open(os.path.join(out, 'meta.json'), 'w') as mf:
                                mf.write(_json.dumps(meta))
                        except Exception as _e:
                            print('warning: failed to write meta.json', _e)
                except Exception as e:
                    print('warning: save_contours_as_dxf failed', e)

                # Ensure traced/offset files exist, otherwise create simple fallbacks
                traced_path = os.path.join(out, 'traced.png')
                offset_path = os.path.join(out, 'offset.png')
                if not os.path.exists(traced_path):
                    # fallback to simple edge-based traced image
                    traced = img.convert('L').filter(ImageFilter.FIND_EDGES)
                    thr = 145 if args.threshold is None else int(args.threshold)
                    mask = traced.point(lambda p: 255 if p > thr else 0)
                    green = Image.new('RGBA', img.size, (0, 255, 0, 255))
                    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
                    overlay.paste(green, (0, 0), mask)
                    base_rgba = img.convert('RGBA')
                    traced_overlay = Image.alpha_composite(base_rgba, overlay)
                    traced_overlay.save(traced_path)
                if not os.path.exists(offset_path):
                    offset_mask = mask.filter(ImageFilter.MaxFilter(5)) if 'mask' in locals() else Image.new('L', img.size, 0)
                    offset_overlay = Image.new('RGBA', img.size, (0, 255, 0, 255))
                    offset_img = Image.alpha_composite(img.convert('RGBA'), Image.new('RGBA', img.size, (0, 0, 0, 0)))
                    offset_img.paste(offset_overlay, (0, 0), offset_mask)
                    offset_img.save(offset_path)
            except Exception as e:
                print('src.processing execution failed, falling back to local method:', e)
                use_src_processing = False
                # fall back to local processing below
        if not use_src_processing:
            # traced: simple edge detection (grayscale)
            traced = img.convert('L').filter(ImageFilter.FIND_EDGES)

            # create a green overlay from traced edges (thresholded)
            # threshold default - treat any edge > 20 as stroke
            thr = 20 if args.threshold is None else int(args.threshold)
            mask = traced.point(lambda p: 255 if p > thr else 0)

            # create green RGBA overlay where mask is set
            green = Image.new('RGBA', img.size, (0, 255, 0, 255))
            overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
            overlay.paste(green, (0, 0), mask)

            # composite overlay onto original to produce traced overlay image
            base_rgba = img.convert('RGBA')
            traced_overlay = Image.alpha_composite(base_rgba, overlay)
            traced_path = os.path.join(out, 'traced.png')
            traced_overlay.save(traced_path)

            # offset: thicken edges via max filter on traced mask
            offset_mask = mask.filter(ImageFilter.MaxFilter(5))
            offset_overlay = Image.new('RGBA', img.size, (0, 255, 0, 255))
            offset_img = Image.alpha_composite(base_rgba, Image.new('RGBA', img.size, (0, 0, 0, 0)))
            offset_img.paste(offset_overlay, (0, 0), offset_mask)
            offset_path = os.path.join(out, 'offset.png')
            offset_img.save(offset_path)

        sys.exit(0)
    except Exception as e:
        print('processing failed:', e)
        sys.exit(1)


def do_export_dxfs(export_dir, projectdir=None):
    """Read .poly.json and .text.json files from export_dir and write DXF files."""
    try:
        import ezdxf
    except Exception as e:
        print('ezdxf is required for export-dxfs mode:', e)
        return

    files = os.listdir(export_dir)
    for f in files:
        lower = f.lower()
        full = os.path.join(export_dir, f)
        try:
            if lower.endswith('.poly.json'):
                with open(full, 'r', encoding='utf8') as fh:
                    import json
                    data = json.load(fh)
                    polylines = data.get('polylines', [])
                    # write DXF
                    doc = ezdxf.new()
                    msp = doc.modelspace()
                    for poly in polylines:
                        pts = []
                        for p in poly:
                            # expect {x,y} in mm
                            x = float(p.get('x', 0))
                            y = float(p.get('y', 0))
                            pts.append((x, y))
                        if pts and pts[0] != pts[-1]:
                            pts.append(pts[0])
                        if pts:
                            msp.add_lwpolyline(pts)
                    # Name DXF by stripping the '.poly.json' suffix to get the original shape name
                    if f.lower().endswith('.poly.json'):
                        base = f[:-len('.poly.json')]
                    else:
                        base = os.path.splitext(f)[0]
                    outname = base + '.dxf'
                    outpath = os.path.join(export_dir, outname)
                    doc.saveas(outpath)
                    print('Wrote DXF from polyjson:', outpath)
            elif lower.endswith('.text.json'):
                # simple placeholder: create a box representing text extents
                with open(full, 'r', encoding='utf8') as fh:
                    import json
                    data = json.load(fh)
                    cx, cy, rot = 0.0, 0.0, 0.0
                    if isinstance(data.get('posXYRot'), (list, tuple)):
                        cx = float(data['posXYRot'][0])
                        cy = float(data['posXYRot'][1])
                        rot = float(data['posXYRot'][2] if len(data['posXYRot'])>2 else 0.0)
                    fontsize = float(data.get('fontSize', data.get('fontSizeMM', 15)))
                    w = fontsize * len(str(data.get('text','')))
                    h = fontsize
                    hw = w/2; hh = h/2
                    corners = [(cx-hw, cy-hh), (cx+hw, cy-hh), (cx+hw, cy+hh), (cx-hw, cy+hh), (cx-hw, cy-hh)]
                    doc = ezdxf.new()
                    msp = doc.modelspace()
                    msp.add_lwpolyline(corners)
                    if f.lower().endswith('.text.json'):
                        base = f[:-len('.text.json')]
                    else:
                        base = os.path.splitext(f)[0]
                    outname = base + '.dxf'
                    outpath = os.path.join(export_dir, outname)
                    doc.saveas(outpath)
                    print('Wrote placeholder DXF for text:', outpath)
            else:
                # skip other files (copy of original dxf will already be present)
                continue
        except Exception as e:
            print('Failed processing', full, e)

    # After writing simple DXFs, check for a manifest that requests transforms
    manifest_path = os.path.join(export_dir, 'export_manifest.json')
    if os.path.exists(manifest_path):
        try:
            import json
            with open(manifest_path, 'r', encoding='utf8') as mf:
                manifest = json.load(mf)
        except Exception as e:
            print('Failed to read export_manifest.json', e)
            manifest = None

        if manifest:
            for entry in manifest:
                try:
                    name = entry.get('name')
                    src = entry.get('src')
                    pos = entry.get('posXYRot', [0, 0, 0])
                    scale = float(entry.get('scale', 1.0))
                    src_path = os.path.join(export_dir, src)
                    if not os.path.exists(src_path):
                        print('Manifest src not found:', src_path)
                        continue
                    # Read source DXF and collect points
                    try:
                        import ezdxf
                    except Exception as e:
                        print('ezdxf needed for DXF transform:', e)
                        continue

                    try:
                        doc = ezdxf.readfile(src_path)
                    except Exception as e:
                        print('Failed to read source DXF for transform:', src_path, e)
                        continue

                    msp = doc.modelspace()
                    pts = []
                    for e in msp:
                        etype = e.dxftype()
                        if etype == 'LWPOLYLINE' or etype == 'POLYLINE':
                            try:
                                for p in e.get_points():
                                    x = float(p[0]); y = float(p[1])
                                    pts.append((x, y))
                            except Exception:
                                # fallback for POLYLINE vertices
                                try:
                                    for v in e.vertices():
                                        pts.append((float(v.dxf.x), float(v.dxf.y)))
                                except Exception:
                                    pass
                        elif etype == 'LINE':
                            try:
                                pts.append((float(e.dxf.start.x), float(e.dxf.start.y)))
                                pts.append((float(e.dxf.end.x), float(e.dxf.end.y)))
                            except Exception:
                                pass
                        elif etype == 'CIRCLE':
                            try:
                                pts.append((float(e.dxf.center.x), float(e.dxf.center.y)))
                            except Exception:
                                pass

                    if not pts:
                        print('No geometry points found in', src_path, '; copying without transform')
                        # just copy as-is to name
                        outpath = os.path.join(export_dir, f"{name}.dxf")
                        try:
                            import shutil
                            shutil.copyfile(src_path, outpath)
                            print('Copied DXF without transform to', outpath)
                        except Exception as e:
                            print('Failed to copy DXF', e)
                        continue

                    # compute bounding-box center (use as transform origin)
                    xs = [p[0] for p in pts]
                    ys = [p[1] for p in pts]
                    minx = min(xs); maxx = max(xs)
                    miny = min(ys); maxy = max(ys)
                    sx = (minx + maxx) / 2.0
                    sy = (miny + maxy) / 2.0

                    # target center from pos (assumed mm)
                    tx = float(pos[0]) if len(pos) > 0 else 0.0
                    ty = float(pos[1]) if len(pos) > 1 else 0.0
                    deg = float(pos[2]) if len(pos) > 2 else 0.0
                    import math
                    rad = math.radians(deg)
                    cosr = math.cos(rad)
                    sinr = math.sin(rad)

                    # create new DXF and transform geometry
                    newdoc = ezdxf.new()
                    newmsp = newdoc.modelspace()

                    for e in msp:
                        etype = e.dxftype()
                        if etype in ('LWPOLYLINE', 'POLYLINE'):
                            pts_in = []
                            try:
                                iter_pts = e.get_points()
                            except Exception:
                                try:
                                    iter_pts = [ (v.dxf.x, v.dxf.y) for v in e.vertices() ]
                                except Exception:
                                    iter_pts = []
                            for p in iter_pts:
                                x = float(p[0]); y = float(p[1])
                                # center, scale, rotate, translate
                                dx = (x - sx) * scale
                                dy = (y - sy) * scale
                                rx = dx * cosr - dy * sinr
                                ry = dx * sinr + dy * cosr
                                fx = rx + tx
                                fy = ry + ty
                                pts_in.append((fx, fy))
                            if pts_in:
                                if pts_in[0] != pts_in[-1]:
                                    pts_in.append(pts_in[0])
                                newmsp.add_lwpolyline(pts_in)
                        elif etype == 'LINE':
                            try:
                                x1 = float(e.dxf.start.x); y1 = float(e.dxf.start.y)
                                x2 = float(e.dxf.end.x); y2 = float(e.dxf.end.y)
                                for (x,y) in ((x1,y1),(x2,y2)):
                                    dx = (x - sx) * scale; dy = (y - sy) * scale
                                dx1 = (x1 - sx) * scale; dy1 = (y1 - sy) * scale
                                rx1 = dx1 * cosr - dy1 * sinr; ry1 = dx1 * sinr + dy1 * cosr
                                fx1 = rx1 + tx; fy1 = ry1 + ty
                                dx2 = (x2 - sx) * scale; dy2 = (y2 - sy) * scale
                                rx2 = dx2 * cosr - dy2 * sinr; ry2 = dx2 * sinr + dy2 * cosr
                                fx2 = rx2 + tx; fy2 = ry2 + ty
                                newmsp.add_line((fx1, fy1), (fx2, fy2))
                            except Exception:
                                pass
                        elif etype == 'CIRCLE':
                            try:
                                cx = float(e.dxf.center.x); cy = float(e.dxf.center.y)
                                r = float(e.dxf.radius) * scale
                                dx = (cx - sx) * scale; dy = (cy - sy) * scale
                                rcx = dx * cosr - dy * sinr; rcy = dx * sinr + dy * cosr
                                fcx = rcx + tx; fcy = rcy + ty
                                newmsp.add_circle((fcx, fcy), r)
                            except Exception:
                                pass

                    outpath = os.path.join(export_dir, f"{name}.dxf")
                    try:
                        newdoc.saveas(outpath)
                        print('Wrote transformed DXF for', name, '->', outpath)
                    except Exception as e:
                        print('Failed to save transformed DXF', e)
                except Exception as e:
                    print('Error processing manifest entry', entry, e)


if __name__ == '__main__':
    main()
