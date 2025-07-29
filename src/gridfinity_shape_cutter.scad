// Import the extended basic cup script
use <modules/module_gridfinity_cup.scad>;

/* [General Settings] */
width = 4; // .5 
depth = 3; // .5
height = 13; // .1

chamfer_height_in = 0.08; // Chamfer height in inches
chamfer_height_mm = chamfer_height_in * 25.4;

/* [Shape Settings] */
// Paste your shape_data from excel here
// shape data format: [[x, y, width, height, depth], ...]
// If height == 0, use circle (width = diameter). If height > 0, use square (width x height)
shape_data = [[-1.75,0.0,2.6,0.0,1.32,],[-4.75,0.0,2.6,0.0,1.32,],[0.66,0.81,1.22,0.0,1.5,],[0.66,-0.81,1.22,0.0,1.5,],[2.28,0.81,1.22,0.0,1.5,],[2.28,-0.81,1.22,0.0,1.5,]];


hole_shift = [0, 0]; // Shift holes by this amount in X and Y

/* [Other Options] */
half_pitch = false;

/* [Hidden] */
// [Hidden] - gridfinity_bin.scad compatibility
// These are required for gridfinity_cup
enable_magnets = false;
lip_style = "none";
filled_in = "enabled";
render_position = "center"; //[default,center,zero]
enable_screws = false;
magnet_easy_release = "off";
screw_size = [3, 6];
hole_overhang_remedy = 2;
floor_thickness = 0.7;
cavity_floor_radius = -1;
efficient_floor = "off";
flat_base = "off";
spacer = false;
flat_base_rounded_radius = -1;
flat_base_rounded_easyPrint = -1;
fa = 1;
fs = 0.4;
fn = 0;
force_render = true;
minimum_printable_pad_size = 0.2;
text_font = "Aldo";

module end_of_customizer_opts() {}

//Some online generators do not like direct setting of fa,fs,fn
$fa = fa; 
$fs = fs; 
$fn = fn;  

magnet_size = [6.5, 2.4];
center_magnet_size = [0,0];
box_corner_attachments_only = true;
text_1 = false;
text_2 = false;
text_2_text = "";
text_size = 0;
text_depth = 0.3;


// Cutouts from shape_data: circles or squares
module shape_cutouts(shape_data, hole_shift, chamfer_height_mm, height, unit_scale=25.4) {
    for (i = [0 : len(shape_data)-1]) {
        shape = shape_data[i];
        xpos = shape[0]*unit_scale + hole_shift[0];
        ypos = shape[1]*unit_scale + hole_shift[1];
        width = shape[2]*unit_scale;
        height_val = shape[3]*unit_scale;
        depth = shape[4]*unit_scale;
        zpos = height*7 - depth/2;
        // Set fa/fs for high resolution based on hole size
        // Smaller fa/fs for higher resolution (smaller segments)
        local_fa = max(0.5, min(4, width/32));
        local_fs = max(0.01, min(0.2, width/128));
        echo(local_fa, local_fs);
        if (shape[3] == 0) {
            // Circle
            translate([xpos, ypos, zpos])
                cylinder(h=depth, d=width, center=true, $fa=local_fa, $fs=local_fs);
            // Chamfer (cone) at top edge
            if (chamfer_height_mm > 0) {
                translate([xpos, ypos, zpos + depth/2 - chamfer_height_mm/2])
                    cylinder(h=chamfer_height_mm, d1=width, d2=width + 2*chamfer_height_mm, center=true, $fa=local_fa, $fs=local_fs);
            }
        } else {
            // Square with chamfered top edge
            translate([xpos, ypos, zpos - depth/2]) {
                // Base extrusion
                linear_extrude(height=depth)
                    polygon([
                        [-width/2, -height_val/2],
                        [width/2, -height_val/2],
                        [width/2, height_val/2],
                        [-width/2, height_val/2]
                    ]);
                // Chamfer at top edge using minkowski
                if (chamfer_height_mm > 0) {
                    translate([0,0,depth])
                        minkowski() {
                            linear_extrude(height=0.01)
                                polygon([
                                    [-width/2, -height_val/2],
                                    [width/2, -height_val/2],
                                    [width/2, height_val/2],
                                    [-width/2, height_val/2]
                                ]);
                            rotate_extrude(convexity=10, $fa=local_fa, $fs=local_fs)
                                polygon([[0,0],[chamfer_height_mm,0],[0,-chamfer_height_mm]]);
                        }
                }
            }
        }
    }
}


// Main model: subtract cylinder from cup
render(convexity = 2)
difference() {
    set_environment(
        width = width,
        depth = depth,
        height = height,
        render_position = render_position,
        force_render = force_render
    )
    gridfinity_cup(
        width=width, depth=depth, height=height,
        filled_in=filled_in,
        lip_settings = LipSettings(
            lipStyle = lip_style,
            lipSideReliefTrigger = [1,1],
            lipTopReliefHeight = -1,
            lipTopReliefWidth = -1,
            lipNotch = false,
            lipClipPosition = "disabled",
            lipNonBlocking = false
        ),
        cupBase_settings = CupBaseSettings(
            magnetSize = enable_magnets?magnet_size:[0,0],
            magnetEasyRelease = magnet_easy_release, 
            centerMagnetSize = center_magnet_size, 
            screwSize = enable_screws?screw_size:[0,0],
            holeOverhangRemedy = hole_overhang_remedy, 
            cornerAttachmentsOnly = box_corner_attachments_only,
            floorThickness = floor_thickness,
            cavityFloorRadius = cavity_floor_radius,
            efficientFloor=efficient_floor,
            halfPitch=half_pitch,
            flatBase=flat_base,
            spacer=spacer,
            minimumPrintablePadSize=minimum_printable_pad_size,
            flatBaseRoundedRadius = flat_base_rounded_radius,
            flatBaseRoundedEasyPrint = flat_base_rounded_easyPrint
        ),
        cupBaseTextSettings = CupBaseTextSettings(
            baseTextLine1Enabled = text_1,
            baseTextLine2Enabled = text_2,
            baseTextLine2Value = text_2_text,
            baseTextFontSize = text_size,
            baseTextFont = text_font,
            baseTextDepth = text_depth
        )
    );
    // Subtract all shapes
    shape_cutouts(shape_data, hole_shift, chamfer_height_mm, height);
}
