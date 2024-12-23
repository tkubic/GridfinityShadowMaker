use <src/core/gridfinity-rebuilt-utility.scad>
use <src/core/gridfinity-rebuilt-holes.scad>

// ===== PARAMETERS ===== //

/* [Setup Parameters] */

// ===== IMPLEMENTATION ===== //
/* [DXF file path] */
// Define a variable for the DXF file path 
dxf_file_path = "DXF/example.dxf";

/* [General Settings] */
// number of bases along x-axis
gridx = 5; //.5
// number of bases along y-axis
gridy = 2; //.5
// bin height. See bin height information and "gridz_define" below.
gridz = 6; //1
style_lip = 1; //[0: Regular lip, 1:remove lip subtractively]

/* [Finger Slot Options] */
// Number of finger slots
num_slots = 1; //[0:1:4] //.5
// Width of each slot
slot_width = 40; // 10
// Array of start positions relative to the x-axis
start_positions = [0,-50, 100,0]; // .1
// Rotation angle of the slots
slot_rotation = 90; // 10

/* [Cut Depth] */
// Variable for cut depth
cut_depth = 10; // 1



/* [Hidden] */
$fa = 8;
$fs = 0.25; // .01
// number of X Divisions (set to zero to have solid bin)
divx = 0;
// number of Y Divisions (set to zero to have solid bin)
divy = 0;
// number of cylindrical X Divisions (mutually exclusive to Linear Compartments)
cdivx = 0;
// number of cylindrical Y Divisions (mutually exclusive to Linear Compartments)
cdivy = 0;
// orientation
c_orientation = 2; // [0: x direction, 1: y direction, 2: z direction]
// diameter of cylindrical cut outs
cd = 10; // .1
// cylinder height
ch = 1;  //.1
// spacing to lid
c_depth = 1;
// chamfer around the top rim of the holes
c_chamfer = 0.5; // .1

style_tab = 1; //[0:Full,1:Auto,2:Left,3:Center,4:Right,5:None]
place_tab = 0;
//style_lip = 1; //[0: Regular lip, 1:remove lip subtractively, 2: remove lip and retain height]
scoop = 1; //[0:0.1:1]
only_corners = false;
refined_holes = false;
magnet_holes = false;
screw_holes = false;
crush_ribs = true;
chamfer_holes = true;
printable_hole_top = true;
enable_thumbscrew = false;
hole_options = bundle_hole_options(refined_holes, magnet_holes, screw_holes, crush_ribs, chamfer_holes, printable_hole_top);
// determine what the variable "gridz" applies to based on your use case
gridz_define = 0;
height_internal = 0;
enable_zsnap = false;

// Function to create the finger slot
module finger_slot(width = 80, start_pos = 0, rotation = 0) {
    rotate([0, 0, rotation]) {
        translate([start_pos - width / 2, -250, gridz*7-cut_depth+1]) { // Start the cut at 21mm above the Z-axis
            cube([width, 500, gridz * 7 + 4.4 + 30], center = false); // Adjust the dimensions and position as needed
        }
    }
}

difference() {
    // Base object to cut from
    gridfinityInit(gridx, gridy, height(gridz, gridz_define, style_lip, enable_zsnap), height_internal, sl = style_lip) {
        if (divx > 0 && divy > 0) {
            cutEqual(n_divx = divx, n_divy = divy, style_tab = style_tab, scoop_weight = scoop, place_tab = place_tab);
        } else if (cdivx > 0 && cdivy > 0) {
            cutCylinders(n_divx = cdivx, n_divy = cdivy, cylinder_diameter = cd, cylinder_height = ch, coutout_depth = c_depth, orientation = c_orientation, chamfer = c_chamfer);
        }
    }

    // Position and extrude the DXF shape to perform the cut
    translate([0, 0, gridz*7-cut_depth]) { // Start the cut from the top surface and cut downward by cut_depth
        linear_extrude(height = cut_depth+1) { // Cut downward by the variable cut_depth
            scale([25.4, 25.4, 1]) { // Scale from inches to mm
                import(dxf_file_path);
            }
        }
    }

    // Add the finger slots
    for (i = [0 : num_slots - 1]) {
        finger_slot(slot_width, start_positions[i], slot_rotation);
    }
}

// Draw the base with holes
gridfinityBase([gridx, gridy], hole_options = hole_options, only_corners = only_corners, thumbscrew = enable_thumbscrew);