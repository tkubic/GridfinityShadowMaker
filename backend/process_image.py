#!/usr/bin/env python
"""
backend/process_image.py

Thin CLI wrapper that delegates image processing to `src.processing`.
This file intentionally keeps minimal responsibilities: parse CLI args,
wire a small display_image writer to save traced/offset images, and call
the corresponding functions in `src.processing`.

This removes the older duplicated implementation and keeps one source
of truth in `src/processing.py`.
"""
import sys
import os
import argparse


def main():
    # Ensure project root is on sys.path so `src` is importable when delegating
    project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if project_root not in sys.path:
        sys.path.insert(0, project_root)

    parser = argparse.ArgumentParser()
    parser.add_argument('--export-dxfs', dest='export_dxfs', type=str, default=None, help='Directory containing .poly.json/.text.json to convert to DXF')
    parser.add_argument('--generate-scad', dest='generate_scad', type=str, default=None, help='Project folder to generate SCAD for')
    parser.add_argument('--projectdir', type=str, default=None)
    parser.add_argument('--workfolder', type=str, default=None)
    parser.add_argument('--threshold', type=float, default=None)
    parser.add_argument('--offset', type=float, default=None)
    parser.add_argument('--token', type=float, default=None)
    parser.add_argument('--resolution', type=int, default=None)
    parser.add_argument('--split', action='store_true')
    parser.add_argument('input_path', nargs='?')
    parser.add_argument('out_dir', nargs='?')
    args = parser.parse_args()

    # Handle export-dxfs mode directly using the helper implemented below
    if args.export_dxfs:
        export_dir = args.export_dxfs
        os.makedirs(export_dir, exist_ok=True)
        do_export_dxfs(export_dir, args.projectdir)
        return 0

    # Handle generate-scad mode
    if args.generate_scad:
        try:
            do_generate_scad(args.generate_scad, args.projectdir)
            return 0
        except Exception as e:
            print('generate-scad failed:', e)
            return 1

    # Otherwise delegate to src.processing CLI
    try:
        from src import processing as sp  # type: ignore
    except Exception as e:
        print('Error: could not import src.processing:', e)
        return 2

    # forward all args to src.processing.cli_main
    try:
        return sp.cli_main(sys.argv[1:])
    except Exception as e:
        print('Delegated processing failed:', e)
        return 3


def do_export_dxfs(export_dir, projectdir=None):
    """Read .poly.json and .text.json files from export_dir and write DXF files."""
    # Try to use ezdxf for robust DXF writing/reading. If it's not available,
    # fall back to a minimal ASCII DXF writer implemented below so exports
    # still succeed in environments without ezdxf installed.
    try:
        import ezdxf
    except Exception as e:
        ezdxf = None
        print('ezdxf not available, will use fallback ASCII DXF writer:', e)

    def write_ascii_dxf_from_polylines(outpath, polylines):
        """Write a very small ASCII DXF containing POLYLINE/VERTEX or LWPOLYLINE entries.
        This is intentionally minimal and aims to be consumable by OpenSCAD and other tools.
        """
        try:
            with open(outpath, 'w', encoding='utf8') as fh:
                fh.write('0\nSECTION\n2\nENTITIES\n')
                for poly in polylines:
                    # write as POLYLINE + VERTEX sequence
                    fh.write('0\nPOLYLINE\n8\n0\n66\n1\n70\n1\n')
                    for p in poly:
                        x = float(p.get('x', 0))
                        y = float(p.get('y', 0))
                        fh.write('0\nVERTEX\n8\n0\n10\n' + repr(x) + '\n20\n' + repr(y) + '\n')
                    fh.write('0\nSEQEND\n')
                fh.write('0\nENDSEC\n0\nEOF\n')
            return True
        except Exception as e:
            print('Fallback ASCII DXF writer failed for', outpath, e)
            return False

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
                    # Name DXF by stripping the '.poly.json' suffix to get the original shape name
                    if f.lower().endswith('.poly.json'):
                        base = f[:-len('.poly.json')]
                    else:
                        base = os.path.splitext(f)[0]
                    outname = base + '.dxf'
                    outpath = os.path.join(export_dir, outname)
                    try:
                        if ezdxf:
                            # write DXF using ezdxf for best compatibility
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
                            doc.saveas(outpath)
                            print('Wrote DXF from polyjson (ezdxf):', outpath)
                        else:
                            # fallback ASCII DXF writer
                            ok = write_ascii_dxf_from_polylines(outpath, polylines)
                            if ok:
                                print('Wrote DXF from polyjson (ascii fallback):', outpath)
                            else:
                                print('Failed to write DXF for', outpath)
                    except Exception as e:
                        print('Failed to write DXF from polyjson:', outpath, e)
            elif lower.endswith('.text.json'):
                # Text vectorization is intentionally disabled for now.
                # Keep the .text.json files (they are written by the server),
                # but do not generate placeholder DXF files from them.
                print('Skipping text DXF generation for', full)
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


def do_generate_scad(project_folder, projectdir=None):
    """Generate SCAD for the given project folder by calling src.processing.import_to_openscad.
    This reads `processing_output/meta.json` (if present) to discover dxf paths
    and grid sizes, copies repo `src` into the project folder if needed, and
    invokes the import_to_openscad helper from `src.processing`.
    """
    try:
        import json
        import shutil
        export_dir = os.path.join(project_folder, 'processing_output')
        if not os.path.exists(project_folder):
            print('Project folder not found:', project_folder)
            return
        if not os.path.exists(export_dir):
            print('processing_output not found in project folder:', export_dir)
            return

        # Ensure project has a local copy of the repository `src` so OpenSCAD includes work
        if projectdir:
            repo_src = os.path.join(projectdir, 'src')
            dst_src = os.path.join(project_folder, 'src')
            try:
                if os.path.exists(repo_src):
                    shutil.copytree(repo_src, dst_src, dirs_exist_ok=True)
            except Exception as e:
                print('Warning: could not copy src into project folder:', e)

        # Build dxf_paths from the project's GSM file if possible.
        # Strictly preserve the order of the `shapes` array and use the
        # shape `name` as the expected DXF filename (append .dxf if missing).
        dxf_paths = []
        try:
            proj_name = os.path.basename(project_folder.rstrip(os.sep))
            gsm_path = os.path.join(project_folder, f"{proj_name}.gsm")
            if os.path.exists(gsm_path):
                try:
                    import json as _json
                    with open(gsm_path, 'r', encoding='utf8') as gf:
                        gsm_obj = _json.load(gf)
                    shapes = None
                    if isinstance(gsm_obj, dict):
                        shapes = gsm_obj.get('shapes') or gsm_obj.get('items') or gsm_obj.get('project')
                    elif isinstance(gsm_obj, list):
                        shapes = gsm_obj
                    if isinstance(shapes, list) and shapes:
                        for sh in shapes:
                            try:
                                if not isinstance(sh, dict):
                                    continue
                                # skip explicit text shapes
                                #if str(sh.get('type')).lower() == 'text':
                                #    continue
                                # Use the UI display name as primary filename
                                nm = sh.get('name') if sh.get('name') is not None else (sh.get('dxfName') or sh.get('dxf_name') or sh.get('id'))
                                if nm is None:
                                    nm = ''
                                sname = str(nm)
                                if sname and not sname.lower().endswith('.dxf'):
                                    sname = f"{sname}.dxf"
                                # build expected path inside processing_output (no sanitization)
                                dxf_paths.append(os.path.join(export_dir, sname) if sname else '')
                            except Exception:
                                dxf_paths.append('')
                except Exception as e:
                    print('Warning: failed to read GSM for DXF ordering', e)
        except Exception as e:
            print('Warning: failed to build dxf_paths from GSM', e)

        # Fallback: if GSM yielded no entries, fall back to scanning processing_output
        if not dxf_paths:
            try:
                all_files = sorted(os.listdir(export_dir))
                for f in all_files:
                    if f.lower().endswith('.dxf'):
                        dxf_paths.append(os.path.join(export_dir, f))
            except Exception as e:
                print('Warning: failed to list processing_output files', e)

        # Try to read grid sizes from meta.json if present (optional), otherwise
        # we will prefer values from the project's GSM (loaded below).
        meta_path = os.path.join(export_dir, 'meta.json')
        gridx = None
        gridy = None
        if os.path.exists(meta_path):
            try:
                with open(meta_path, 'r', encoding='utf8') as mf:
                    meta = json.load(mf)
                    if meta:
                        gridx = meta.get('gridx_size')
                        gridy = meta.get('gridy_size')
            except Exception as e:
                print('Warning: failed to read meta.json', e)

        # We'll map per-shape depths from the project's GSM (if present) below
        # after loading the project file.

        # Default grid sizes
        if gridx is None: gridx = None
        if gridy is None: gridy = None

        # Prefer project file values (gsm or project.json) when present
        try:
            proj_name = os.path.basename(project_folder.rstrip(os.sep))
            gsm_path = os.path.join(project_folder, f"{proj_name}.gsm")
            pj_path = os.path.join(project_folder, 'project.json')
            project_obj = None
            if os.path.exists(gsm_path):
                try:
                    with open(gsm_path, 'r', encoding='utf8') as f:
                        import json as _json
                        project_obj = _json.load(f)
                except Exception:
                    project_obj = None
            elif os.path.exists(pj_path):
                try:
                    with open(pj_path, 'r', encoding='utf8') as f:
                        import json as _json
                        project_obj = _json.load(f)
                except Exception:
                    project_obj = None

            # Prefer `board` (the canonical board data) if present
            bp = None
            if project_obj and isinstance(project_obj, dict):
                bp = project_obj.get('board')
            if bp and isinstance(bp, dict):
                try:
                            if gridx is None:
                                if 'gridX' in bp:
                                    gridx = int(bp.get('gridX'))
                                elif 'width' in bp:
                                    gridx = int(bp.get('width'))
                            if gridy is None:
                                if 'gridY' in bp:
                                    gridy = int(bp.get('gridY'))
                                elif 'depth' in bp:
                                    gridy = int(bp.get('depth'))
                            gridz = None
                            if 'height7Units' in bp:
                                try:
                                    gridz = int(bp.get('height7Units'))
                                except Exception:
                                    gridz = None
                            elif 'height' in bp:
                                try:
                                    gridz = int(bp.get('height'))
                                except Exception:
                                    gridz = None
                            elif 'gridZ' in bp:
                                try:
                                    gridz = int(bp.get('gridZ'))
                                except Exception:
                                    gridz = None
                            elif 'heightMM' in bp:
                                try:
                                    gridz = int(bp.get('heightMM'))
                                except Exception:
                                    gridz = None
                except Exception:
                    pass
        except Exception:
            pass

        # Final defaults if still unset
        if gridx is None: gridx = 5
        if gridy is None: gridy = 2
        # Default gridz (height) if not specified
        try:
            gridz
        except NameError:
            gridz = None
        if gridz is None:
            gridz = 6

        # Import src.processing from the repository root (projectdir) so we use canonical code
        if projectdir:
            import sys as _sys
            _sys.path.insert(0, projectdir)

        try:
            import src.processing as sp  # type: ignore
        except Exception as e:
            print('Failed to import src.processing for SCAD generation:', e)
            return

        class DummyConsole:
            def setText(self, s):
                print('console:', s)

        file_name = os.path.basename(project_folder.rstrip(os.sep))
        folder_name = os.path.basename(project_folder.rstrip(os.sep))

        # Call import_to_openscad. It accepts either a single path or a list.
        try:
            if len(dxf_paths) > 1:
                sp.import_to_openscad(dxf_paths, gridx, gridy, DummyConsole(), file_name, folder_name, splitDXF=True, gridz_size=gridz)
            elif len(dxf_paths) == 1:
                sp.import_to_openscad(dxf_paths[0], gridx, gridy, DummyConsole(), file_name, folder_name, splitDXF=False, gridz_size=gridz)
            else:
                # No DXFs; still call to produce a SCAD with defaults
                sp.import_to_openscad('', gridx, gridy, DummyConsole(), file_name, folder_name, splitDXF=False, gridz_size=gridz)
            scad_path = os.path.join(project_folder, f"{file_name}.scad")
            print('Generated SCAD:', scad_path)
        except Exception as e:
            print('import_to_openscad failed:', e)
    except Exception as e:
        print('do_generate_scad failed:', e)


if __name__ == '__main__':
    main()
