#!/usr/bin/env python
import sys
import os
from PIL import Image, ImageFilter
import argparse


def usage():
    print("usage: process_image.py <input_path> <output_dir> [--threshold N] [--offset N] [--token N] [--resolution N]")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('input_path')
    parser.add_argument('out_dir')
    parser.add_argument('--projectdir', type=str, default=None)
    parser.add_argument('--workfolder', type=str, default=None)
    parser.add_argument('--threshold', type=float, default=None)
    parser.add_argument('--offset', type=float, default=None)
    parser.add_argument('--token', type=float, default=None)
    parser.add_argument('--resolution', type=int, default=None)
    args = parser.parse_args()

    inp = args.input_path
    out = args.out_dir
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


if __name__ == '__main__':
    main()
