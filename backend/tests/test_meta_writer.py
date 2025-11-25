#!/usr/bin/env python3
"""
Simple test to validate the meta.json writer behavior for both single-path and
multi-path (splitDXF) DXF outputs. This duplicates the meta-writing logic from
`backend/process_image.py` and asserts the output format.

Run from repo root (or from backend/):
  python -m backend.tests.test_meta_writer
or
  python backend/tests/test_meta_writer.py
"""
import os
import json
import tempfile
import shutil


def write_meta(out_dir, dxf_res):
    """Replicate the meta.json writing logic used by process_image.py
    dxf_res is expected to be a tuple: (dxf_path_or_list, gridx_size, gridy_size)
    """
    dxf_path_raw, gridx_size, gridy_size = dxf_res
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
    with open(os.path.join(out_dir, 'meta.json'), 'w', encoding='utf8') as mf:
        mf.write(json.dumps(meta))
    return meta


def test_single_path(tmpdir):
    out = tmpdir
    # create a dummy single dxf file
    single = os.path.join(out, 'single.dxf')
    with open(single, 'w', encoding='utf8') as f:
        f.write('')

    meta = write_meta(out, (single, 10, 20))
    # validations
    assert meta['dxf_path'] == os.path.abspath(single)
    assert isinstance(meta['dxf_paths'], list) and meta['dxf_paths'][0] == os.path.abspath(single)
    assert meta['gridx_size'] == 10 and meta['gridy_size'] == 20

    # Verify file exists and content parses
    with open(os.path.join(out, 'meta.json'), 'r', encoding='utf8') as mf:
        parsed = json.load(mf)
    assert parsed == meta


def test_multi_path(tmpdir):
    out = tmpdir
    paths = []
    for i in range(3):
        p = os.path.join(out, f'contour_{i}.dxf')
        with open(p, 'w', encoding='utf8') as f:
            f.write('')
        paths.append(p)

    meta = write_meta(out, (paths, 7, 8))
    assert meta['dxf_path'] == os.path.abspath(paths[0])
    assert len(meta['dxf_paths']) == 3
    for i, p in enumerate(paths):
        assert meta['dxf_paths'][i] == os.path.abspath(p)

    with open(os.path.join(out, 'meta.json'), 'r', encoding='utf8') as mf:
        parsed = json.load(mf)
    assert parsed == meta


def run_all():
    tmpdir = tempfile.mkdtemp(prefix='gsm_test_meta_')
    try:
        print('Running single-path test...')
        test_single_path(tmpdir)
        print('single-path OK')
        # clean out dummies
        for f in os.listdir(tmpdir):
            os.remove(os.path.join(tmpdir, f))

        print('Running multi-path test...')
        test_multi_path(tmpdir)
        print('multi-path OK')
        print('All tests passed — meta.json writer handles single and multi-path DXF outputs.')
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


if __name__ == '__main__':
    run_all()
