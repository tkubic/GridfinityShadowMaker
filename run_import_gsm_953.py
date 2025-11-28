from src.processing import import_to_openscad
import os

class DummyConsole:
    def setText(self, s):
        print(s)

# Build relative paths for DXFs inside the project folder
dxf_list = [
    "processing_output/DXF - Hex Bits_contour_1.dxf",
    "processing_output/DXF - Hex Bits_contour_2.dxf",
    "processing_output/DXF - Hex Bits_contour_3.dxf",
    "processing_output/DXF - Hex Bits_contour_4.dxf",
    "processing_output/DXF - Hex Bits_contour_5.dxf",
    "processing_output/DXF - Hex Bits_contour_6.dxf",
    "processing_output/DXF - Hex Bits_contour_7.dxf",
    "processing_output/DXF - Hex Bits_contour_8.dxf",
    "processing_output/Text-9.dxf",
]

# Call import_to_openscad to regenerate the SCAD in the project folder
import_to_openscad(dxf_list, None, None, DummyConsole(), "GSM-20251128-953", "GSM-20251128-953", splitDXF=True)
print('import_to_openscad finished')
