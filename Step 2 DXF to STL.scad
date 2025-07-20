use <src/modules/module_gridfinity_cup.scad>
use <src/modules/module_finger_slot.scad>

// ===== PARAMETERS ===== //
/* [General Settings] */
// [width, depth, height]
size = [5, 2, 6]; // .1 
// [units,mm] units or mm, ex: [2,0] or [0,84]
width = [size[0], 0]; // .1
// [units,mm] units or mm, ex: [2,0] or [0,84]
depth = [size[1], 0]; // .1
// [units,mm] units or mm, ex: [6,0] or [0,42]
height = [size[2], 0]; // .1
// === Chamfered DXF Extrusion Option === //
use_chamfered_extrude = true; // Set to true to use chamfered extrusion
chamfer_height = 5;      // mm, height of chamfer

lip_style = "none";  // [ normal, reduced, reduced_double, minimum, none:not stackable ]

/* [DXF Options] */
// DXF file path 
dxf_file_path = "examples/example.dxf";
// [x position, y position, rotation degrees]
position = [[0, 0, 0]]; // .1


/* [Finger Slot Options] */
use_finger_slots = true; // true or false

slot_shape_1 = "scoop"; // [none, rectangle, oval, scoop, triangle, keyhole, teardrop]
// Per-slot parameters: [len, width, height, rot]
slot_params_1 = [80, 40, 9, 0]; // length (mm), width (mm), height (mm), rotation (deg)
slot_pos_1 = [0, 0]; // Translation position [x, y] in mm

// Combine per-slot variables into arrays for use in modules
slot_shape = [slot_shape_1];
slot_params = [slot_params_1];
slot_pos = [slot_pos_1];

/* [Section Adjustments] */


/* [Base Options] */
half_pitch = false;
enable_magnets = false;
magnet_size = [6.1, 3.2];  // .1
//size of center magnet, [diameter, height] 
center_magnet_size = [0,0]; // .1
//Only add magnets to corners
box_corner_attachments_only = false;

/* [Bottom Text] */
// Add bin size to bin bottom
text_1 = false;
// Font Size of text, in mm (0 will auto size)
text_size = 0; // 0.1
// Depth of text, in mm
text_depth = 0.3; // 0.01
// Add free-form text line to bin bottom (printing date, serial, etc)
text_2 = false;
// Actual text to add
text_2_text = "Gridfinity Extended";

/* [Magnet Post] */
include_post = false; // true or false
magnet_post_diameter = 6.1; // [1:0.1:30]
magnet_post_height = 2.9;   // [1:0.1:13] 
magnet_post_position = [0, 0]; // [x, y]
post_cut_depth = 1; // Depth of the magnet post

/* [Label Cutout] */
include_cutout = false; // true or false
cutout_height = 1.8;
include_label = false; // true or false
label_height = 11; // 1
label_width = 80; // 5
label_thickness = 4;
label_clearance = 0.1; //
label_position_x = 0; // 10
label_position_y = 0; // 10

text_thickness = 0.6; // height of the text in mm
input_text_value = "Custom Text"; // Input text value
label_text_size = 6; // Size of the text on the label in mm

// Label Rotation
label_rotation = 0;

// Label Position Options
label_position_option = "bottom"; // ["bottom", "top", "right", "left"]

/* [Hidden] */
// [Hidden] - gridfinity_bin.scad compatibility
// These are required for gridfinity_cup
multiple_dxf = false;
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
fa = 6;
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

// Chamfered extrusion module (from wrenches chamfer.scad)
module chamfered_extrude(
    dxf,
    base_height,
    chamfer_height
) {
    linear_extrude(height=base_height)
        scale([25.4, 25.4])
            import(dxf);
    translate([0,0,base_height])
        minkowski() {
            linear_extrude(height=0.01)
                scale([25.4, 25.4])
                    import(dxf);
            rotate_extrude(convexity=10)
                polygon([[0,0],[chamfer_height,0],[0,-chamfer_height]]);
        }
}

// --- Sectioned DXF modules copied from sections.scad ---
module extrude_dxf_section(dxf_file_path, cut_depth) {
    if (use_chamfered_extrude) {
        chamfered_extrude(
            dxf=dxf_file_path,
            base_height=cut_depth,
            chamfer_height=chamfer_height
        );
    } else {
        linear_extrude(height = cut_depth) {
            scale([25.4, 25.4, 1]) {
                import(dxf_file_path);
            }
        }
    }
}

module three_section_shape(width, depth, section_cut_depth, section_parameters) {
    section_width = section_parameters[0];
    section_position = section_parameters[1];
    section_angle = section_parameters[2];
    total_width = max(width[0],depth[0]) * 42*sqrt(2); // sqrt(2) to account for diagonal
    total_depth = max(width[0],depth[0]) * 42*sqrt(2); // sqrt(2) to account for diagonal
    center_w = section_width;
    pos = max(-200, min(200, section_position));
    center_x = (total_width - center_w) / 2 + pos;
    left_w = max(0, center_x);
    right_w = max(0, total_width - (center_x + center_w));

    // Rotate about the center of the bounding box
    translate([0, 0, 0]) {
        rotate([0, 0, section_angle]) {
            translate([-total_width/2, min(-total_depth/2,-total_width/2), 0]) {
                // Left section
                if (left_w > 0)
                    translate([0, 0, max(section_cut_depth)-section_cut_depth[0]])
                        cube([left_w, max(total_depth, total_width), section_cut_depth[0]+1], center = false);

                // Center section
                translate([left_w, 0, max(section_cut_depth)-section_cut_depth[1]])
                    cube([center_w, max(total_depth, total_width), section_cut_depth[1]+1], center = false);

                // Right section
                if (right_w > 0)
                    translate([left_w + center_w, 0, max(section_cut_depth)-section_cut_depth[2]])
                        cube([right_w, max(total_depth, total_width), section_cut_depth[2]+1], center = false);
            }
        }
    }
}

module dxf_three_section_shape(width, depth, section_cut_depth, section_parameters, dxf_file_path) {
    intersection() {
        three_section_shape(width, depth, section_cut_depth, section_parameters);
        extrude_dxf_section(dxf_file_path, max(section_cut_depth));
    }
}

// Outer difference to cut the post hole through everything
// Set render_position globally for gridfinity_cup centering
render(convexity = 2)
difference() {
    // Main model
    union() {
        difference() {
            // Base object to cut from
            set_environment(
                width = width,
                depth = depth,
                height = height,
                render_position = render_position,
                force_render = force_render)
            gridfinity_cup(
                width=width, depth=depth, height=height,
                filled_in="enabled",
                lip_settings = LipSettings(
                    lipStyle = lip_style, // use user-set lip style
                    lipSideReliefTrigger = [1,1],
                    lipTopReliefHeight = -1,
                    lipTopReliefWidth = -1,
                    lipNotch = false,
                    lipClipPosition = "disabled",
                    lipNonBlocking = false),
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
                    flatBaseRoundedEasyPrint = flat_base_rounded_easyPrint),
                cupBaseTextSettings = CupBaseTextSettings(
                    baseTextLine1Enabled = text_1,
                    baseTextLine2Enabled = text_2,
                    baseTextLine2Value = text_2_text,
                    baseTextFontSize = text_size,
                    baseTextFont = text_font,
                    baseTextDepth = text_depth)
            );

            // Position, rotate, and extrude the DXF shape to perform the cut
            if (!multiple_dxf) {
                translate([dxf_position[0][0], dxf_position[0][1], height[0]*7-(use_section_cut ? max(section_cut_depth[0]) : cut_depth)-(include_cutout ? cutout_height : 0)]) {
                    rotate([0, 0, position[0][2]]) {
                        if (use_section_cut) {
                            dxf_three_section_shape(
                                width, depth, section_cut_depth[0], section_parameters[0],
                                dxf_file_path
                            );
                        } else {
                            extrude_dxf_section(dxf_file_path, cut_depth+1+(include_cutout ? cutout_height : 0));
                        }
                    }
                }
            } else {
                for (i = [0 : len(dxf_file_paths) - 1]) {
                    translate([position[i][0], position[i][1], height[0]*7 - (use_section_cut ? max(section_cut_depth[i]) : dxf_cut_depths[i]) - (include_cutout ? cutout_height : 0)]) {
                        rotate([0, 0, position[i][2]]) {
                            if (use_section_cut) {
                                dxf_three_section_shape(
                                    width, depth, section_cut_depth[i], section_parameters[i],
                                    dxf_file_paths[i]
                                );
                            } else {
                                extrude_dxf_section(dxf_file_paths[i], dxf_cut_depths[i] + (include_cutout ? cutout_height : 0));
                            }
                        }
                    }
                }
            }
            // Add the finger slots
            if (use_finger_slots) {
                for (i = [0 : len(slot_shape) - 1]) {
                    if (slot_shape[i] != "none") {
                        finger_slot(height[0], slot_shape[i], slot_params[i], slot_pos[i]);
                    }
                }
            }

            // Add label slot if include_label is true
            if (include_label) {
                if (label_position_option == "bottom") {
                    translate([0 + label_position_x, -depth[0] * 42 / 2 + label_height / 2 + 5 + label_position_y, height[0] * 7 - label_thickness / 2]) {
                        rotate([0, 0, label_rotation]) {
                            cube([label_width + label_clearance, label_height + label_clearance, label_thickness], center = true);
                        }
                    }
                } else if (label_position_option == "top") {
                    translate([0 + label_position_x, depth[0] * 42 / 2 - label_height / 2 - 5 + label_position_y, height[0] * 7 - label_thickness / 2]) {
                        rotate([0, 0, label_rotation]) {
                            cube([label_width + label_clearance, label_height + label_clearance, label_thickness], center = true);
                        }
                    }
                } else if (label_position_option == "right") {
                    translate([width[0] * 42 / 2 - label_height / 2 - 5 + label_position_x, 0 + label_position_y, height[0] * 7 - label_thickness / 2]) {
                        rotate([0, 0, label_rotation]) {
                            cube([label_height + label_clearance, label_width + label_clearance, label_thickness], center = true);
                        }
                    }
                } else if (label_position_option == "left") {
                    translate([-width[0] * 42 / 2 + label_height / 2 + 5 + label_position_x, 0 + label_position_y, height[0] * 7 - label_thickness / 2]) {
                        rotate([0, 0, label_rotation]) {
                            cube([label_height + label_clearance, label_width + label_clearance, label_thickness], center = true);
                        }
                    }
                }
            }
        }

        // Conditionally extrude the magnet post cylinder from z=7 to height[0]*7
        if (include_post) {
            translate([magnet_post_position[0], magnet_post_position[1], 7]) {
                cylinder(
                    h = height[0]*7 - 7 - post_cut_depth,
                    r = magnet_post_diameter/2 + 3,
                    center = false
                );
            }
        }
    }

    // Subtract cylinder at the top (cuts through everything)
    if (include_post) {
        translate([magnet_post_position[0], magnet_post_position[1], height[0]*7 - post_cut_depth - magnet_post_height]) {
            cylinder(
                h = magnet_post_height + .01,
                r = magnet_post_diameter/2,
                center = false
            );
        }
    }
}

// Conditionally extrude the DXF if include_cutout is true
if (include_cutout) {
    translate([0, depth[0]*42+5, 0]) {
        linear_extrude(height = cutout_height) {
            scale([25.4, 25.4, 1]) {
                import(dxf_file_path);
            }
        }
    }
}

// Conditionally extrude the magnet post cylinder from z=7 to height[0]*7
if (include_post) {
    difference() {
        // Main magnet post
        translate([magnet_post_position[0], magnet_post_position[1], 7]) {
            cylinder(
                h = height[0]*7 - 7 - post_cut_depth,
                r = magnet_post_diameter/2 + 3,
                center = false
            );
        }
        // Subtract cylinder at the top
        translate([magnet_post_position[0], magnet_post_position[1], height[0]*7 - post_cut_depth - magnet_post_height]) {
            cylinder(
                h = magnet_post_height + .01,
                r = magnet_post_diameter/2,
                center = false
            );
        }
    }
}


// Conditionally extrude the label if include_label is true
if (include_label) {
    // Adjust the position of the label based on depth[0]
    translate([0, -depth[0]*42/2-5-label_height/2, label_thickness/2]) {
        union() {
            cube([label_width, label_height, label_thickness], center = true);
            // Add text on top of the label
            translate([0, 0,label_thickness/2]) {
                linear_extrude(height = text_thickness) {
                    text(input_text_value, size = label_text_size, font = text_font, halign = "center", valign = "center");
                }
            }
        }
    }
}