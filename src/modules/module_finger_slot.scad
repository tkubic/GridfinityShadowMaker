// Parametric OpenSCAD module with Customizer dropdown for finger slot shapes
// Usage: Select shape from Customizer dropdown

// Dropdown for selecting shape
shape = "rectangle"; // [rectangle, oval, scoop, triangle, keyhole, teardrop]

// Combined parameters: [length, width, height, rotation_z]
slot_params = [30, 15, 6, 0]; // length (mm), width (mm), height (mm), rotation Z (deg)
slot_pos = [0, 0]; // Translation position [x, y] in mm
z_offset = 0;

module finger_slot(z_offset, shape, slot_params, slot_pos) {
    //shape, length, width, height, radius
    length = slot_params[0];
    width = slot_params[1];
    height = slot_params[2];
    radius = width / 2;
    rotation_z = slot_params[3];
    translate([slot_pos[0], slot_pos[1], z_offset*7])
        rotate([0,0,rotation_z])
        union() {
            // Original shape
            if (shape == "oval") {
                // Proper Oval (outer dimension equals length)
                translate([0, 0, -height])
                linear_extrude(height)
                    scale([length / width, 1])
                        circle(r=width / 2);
            } else if (shape == "keyhole") {
                // Keyhole (Circular end + narrow slot)
                rotate([0,0,-90])
                translate([0, length-width/2, -height])
                union() {
                    cylinder(r=width/2, h=height);
                    translate([-width/2,-length+width/2,0])
                        cube([width, length-width/2, height]);
                }
            } else if (shape == "scoop") {
                // Half-Oval scoop (on its side)
                difference() {
                    rotate([90,0,0])
                    translate([0,0,-width/2])
                    linear_extrude(width)
                        scale([length/height/2, 1])
                            circle(r=height);
                    translate([0,0,height/2])
                        cube([length, width+.01, height], center=true);
                }
            } else if (shape == "teardrop") {
                // Teardrop shape (flipped around Y-axis)
                rotate([0,180,-90])
                translate([0, width/4, 0])
                hull() {
                    cylinder(r=width/4, h=height);
                    translate([0, length-width*.75, 0]) cylinder(r1=radius, r2=radius/2, h=height);
                }
            } else if (shape == "triangle") {
                // Triangle (Centered)
                rotate([-90,0,0])
                translate([0, height/2, -width/2])
                linear_extrude(width)
                    polygon(points=[[-length/2, -height/2], [0, height/2], [length/2, -height/2]]);
            } else if (shape == "rectangle") {
                // Rectangle shape (Centered)
                translate([-length/2, -width/2, -height])
                    cube([length, width, height]);
            } else {
                echo("Unknown shape: ", shape);
            }
            // Mirrored shape across XY plane, scaled in Z by 10
            mirror([0,0,1])
                scale([1,1,10])
                    if (shape == "oval") {
                        translate([0, 0, -height])
                        linear_extrude(height)
                            scale([length / width, 1])
                                circle(r=width / 2);
                    } else if (shape == "keyhole") {
                        rotate([0,0,-90])
                        translate([0, length-width/2, -height])
                        union() {
                            cylinder(r=width/2, h=height);
                            translate([-width/2,-length+width/2,0])
                                cube([width, length-width/2, height]);
                        }
                    } else if (shape == "scoop") {
                        difference() {
                            rotate([90,0,0])
                            translate([0,0,-width/2])
                            linear_extrude(width)
                                scale([length/height/2, 1])
                                    circle(r=height);
                            translate([0,0,height/2])
                                cube([length, width+.01, height], center=true);
                        }
                    } else if (shape == "teardrop") {
                        rotate([0,180,-90])
                        translate([0, width/4, 0])
                        hull() {
                            cylinder(r=width/4, h=height);
                            translate([0, length-width*.75, 0]) cylinder(r1=radius, r2=radius/2, h=height);
                        }
                    } else if (shape == "triangle") {
                        rotate([-90,0,0])
                        translate([0, height/2, -width/2])
                        linear_extrude(width)
                            polygon(points=[[-length/2, -height/2], [0, height/2], [length/2, -height/2]]);
                    } else if (shape == "rectangle") {
                        translate([-length/2, -width/2, -height])
                            cube([length, width, height]);
                    }
        }
}

// Render of selected shape (now includes mirror inside the module)
finger_slot(z_offset, shape, slot_params, slot_pos);
