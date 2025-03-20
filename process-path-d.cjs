//@ts-check

const removeExtraCs = true;
const convertToRelative = true;
const keepSmallerCommand = true;
const scalepoints = true;

/**
 *
 * @param {string} d
 * @param {import("./process-svg.cjs").processDataOptions} options
 * @param {SVGPathElement} [pathElement]
 */
const processPathD = (d, options, pathElement) => {
  d = d.replace(/,/g, " "); // Replace commas with spaces
  d = d.replace(/(\.\d+)(?=(\.\d+))/g, "$1 "); // Add space between decimals

  d = d.replace(/\s+([clshvmz])/gim, "$1"); // Remove leading whitespace before commands
  d = d.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers

  // Simplify path data
  /** @type {string[]} */
  const allCommands = d.match(/[a-zA-Z][^a-zA-Z]*/g) || [];
  const pathData = allCommands.map(command => {
    const code = command.trim()[0];
    const commanddata = command.replace(code, "").trim();

    //Collect all the digits in the command
    const digits = [...commanddata.matchAll(/\s*-?[.\d]+\s*/g)].map(x =>
      parseFloat(x[0])
    );

    /**
     * @type {{x?: number, y?: number, absx?: number, absy?: number}[]}
     */
    let coordinates = [];

    if (code.toLowerCase() === "h") {
      coordinates = digits.map(x => ({ x }));
    } else if (code.toLowerCase() === "v") {
      coordinates = digits.map(y => ({ y }));
    } else if (code.toLowerCase() === "z") {
      //
    } else {
      for (let i = 0; i < digits.length; i += 2) {
        if (i + 1 < digits.length) {
          // Check to ensure there is a pair
          coordinates.push({ x: digits[i], y: digits[i + 1] });
        }
      }
    }

    return { code, coordinates, z: false, abs: /[A-Z]/.test(code) };
  });

  const commandsizes = { c: 3, q: 2, s: 2, l: 1, m: 1, h: 1, v: 1 };

  //Split "c" commands into groups of 3
  for (let i = 0; i < pathData.length; i++) {
    const code = pathData[i].code;

    /** @type {number} */
    const commandsize = commandsizes[code];

    if (pathData[i].coordinates.length > commandsize) {
      const newCommands = [];
      for (let j = 0; j < pathData[i].coordinates.length; j += commandsize) {
        newCommands.push({
          code,
          coordinates: pathData[i].coordinates.slice(j, j + commandsize),
          z: false,
          abs: pathData[i].abs
        });
      }
      pathData.splice(i, 1, ...newCommands);
    }
  }

  if (scalepoints) {
    // find scale
    let scale = 1;
    pathData.forEach(command => {
      if (pathElement) {
        // If the element is specified, scale the path data and stroke width

        // Find the most decimal places in the path data
        command.coordinates.forEach(point => {
          [point.x, point.y].forEach(val => {
            const decimalPlaces = Math.min(
              options.maxDecimalPlaces,
              (val?.toString().split(".")[1] || "").length
            );
            scale = Math.max(scale, Math.pow(10, decimalPlaces));
          });
        });
      }
    });

    if (scale !== 1) {
      if (pathElement) {
        pathElement.setAttribute(
          "transform",
          `scale(${(1 / scale).toString().replace(/^0\./, ".")})`
        );

        const props = getVisibilityProperties(pathElement);
        if (
          props.stroke !== "none" ||
          pathElement.hasAttribute("stroke-width")
        ) {
          pathElement.setAttribute(
            "stroke-width",
            (props.strokeWidth * scale).toString()
          );
        }

        // Find any fill gradients and scale them
        if (props.fill.startsWith("url(") || props.stroke.startsWith("url(")) {
          const idString = props.fill.startsWith("url(")
            ? props.fill
            : props.stroke;
          const idQuery = idString.replace("url(", "").replace(")", "");
          const gradient = pathElement.ownerDocument.querySelector(idQuery);
          if (gradient) {
            //Scale all the numbers in the transform
            const transform = gradient.getAttribute("gradientTransform");
            if (transform) {
              if (transform.startsWith("matrix")) {
                const match = transform.match(/matrix\(([^)]+)\)/);
                if (match) {
                  //Apply the gradientTransform to the gradient coordinates
                  const coordinateNames = ["x1", "y1", "x2", "y2"];

                  const [x1, y1, x2, y2] = coordinateNames
                    .map(field => gradient.getAttribute(field))
                    .filter(x => x !== null)
                    .map(parseFloat);

                  const [a, b, c, d, e, f] = match[1]
                    .split(" ")
                    .map(parseFloat);

                  // Apply the matrix transformation to each coordinate
                  const newX1 = a * x1 + c * y1 + e;
                  const newY1 = b * x1 + d * y1 + f;
                  const newX2 = a * x2 + c * y2 + e;
                  const newY2 = b * x2 + d * y2 + f;

                  // Update the gradient with the transformed coordinates
                  [newX1, newY1, newX2, newY2].forEach((val, i) => {
                    gradient.setAttribute(coordinateNames[i], val.toFixed(0));
                  });

                  // Remove the gradientTransform attribute as it's now applied
                  gradient.removeAttribute("gradientTransform");
                }
              }
            }

            if (!gradient.hasAttribute("data-scaled")) {
              gradient.setAttribute("data-scaled", "true");
              // No Transform, Scale the x1, y1, x2, y2 attributes
              [...gradient.attributes]
                .filter(attr => ["x1", "y1", "x2", "y2"].includes(attr.name))
                .forEach(attr => {
                  attr.value = (parseFloat(attr.value) * scale).toString();
                });
            }
          }
        }
      }
    }
    // scale is determined.  Round and scale
    pathData.forEach(command => {
      command.coordinates.forEach(point => {
        if (pathElement) {
          if (point.x !== undefined) point.x = Math.round(point.x * scale);
          if (point.y !== undefined) point.y = Math.round(point.y * scale);
        } else {
          const scaleFactor = Math.pow(options.maxDecimalPlaces, 10);

          if (point.x !== undefined)
            point.x = Math.round(point.x * scaleFactor) / scaleFactor;
          if (point.y !== undefined)
            point.y = Math.round(point.y * scaleFactor) / scaleFactor;
        }
      });
    });
  }

  if (convertToRelative) {
    const startLocation = { x: 0, y: 0 };
    const pointLocation = { x: 0, y: 0 };
    pathData.forEach((command, i) => {
      if (command.code.toLowerCase() === "z") {
        pointLocation.x = startLocation.x;
        pointLocation.y = startLocation.y;
      } else {
        // Convert absolute commands, except the first one, to relative
        if (command.abs && i > 0) {
          command.code = command.code.toLowerCase();
          command.coordinates.forEach(point => {
            point.absx = point.x;
            point.absy = point.y;
            if (point.x !== undefined) point.x -= pointLocation.x;
            if (point.y !== undefined) point.y -= pointLocation.y;
          });
        }

        const lastpoint = command.coordinates[command.coordinates.length - 1];

        if (lastpoint?.x) pointLocation.x += lastpoint.x;
        if (lastpoint?.y) pointLocation.y += lastpoint.y;

        if (command.code.toLowerCase() === "m") {
          startLocation.x = pointLocation.x;
          startLocation.y = pointLocation.y;
        }
      }
    });
  }

  // Do some cleanup before rending the simplified path data
  for (let i = 1; i < pathData.length; i++) {
    if (pathData[i].code.toLowerCase() === "z") {
      pathData[i - 1].z = true;
      pathData.splice(i, 1);
      i--;
    }
  }

  // render simplified path data
  d = pathData
    .map(command => {
      const code = command.code;
      const coordinates = command.coordinates.map(point =>
        `${point.x ?? ""} ${point.y ?? ""}`.trim()
      ); // Convert coordinates back to string
      const z = command.z ? "z" : "";
      const newCommand = `${code}${coordinates.join(" ")}${z}`.replace(
        / -/g,
        "-"
      ); // Remove space before negative numbers

      if (command.abs && keepSmallerCommand) {
        const absCoordinates = command.coordinates.map(point =>
          `${point.absx ?? point.x ?? ""} ${point.absy ?? point.y ?? ""}`.trim()
        ); // Convert coordinates back to string
        const absCommand =
          `${code.toUpperCase()}${absCoordinates.join(" ")}${z}`.replace(
            / -/g,
            "-"
          ); // Remove space before negative numbers

        return absCommand.length < newCommand.length ? absCommand : newCommand;
      } else {
        return newCommand;
      }
    })
    .join("");

  d = d.replace(/s0 0\s*(-?\d+)\s*(-?\d+)/gm, "l$1 $2"); // line

  //s curve with no curve before it
  d = d.replace(/([h|v|l][^a-zA-Z]+)s([^a-zA-Z]+)/gm, "$1c0 0 $2"); //independent curve

  d = d.replaceAll(
    /c\s*(-?\d+)\s*(-?\d+)\s*(-?\d+)\s*(-?\d+)\s*(-?\d+)\s*(-?\d+)/gm,
    (match, ...params) => {
      const [x0, y0, x1, y1, x2, y2] = params.map(parseFloat);
      if (x0 === 0 && y0 === 0) {
        if ((x1 === 0 && y1 === 0) || y1 / x1 === y2 / x2)
          return `l${x2} ${y2}`;

        if (x2 === 0 && y2 === 0) return "";
      }
      if (
        x0 === 0 &&
        x1 === 0 &&
        x2 === 0 &&
        ((y0 <= y1 && y1 <= y2) || (y0 >= y1 && y1 >= y2))
      )
        return `v${y2}`;

      if (
        y0 === 0 &&
        y1 === 0 &&
        y2 === 0 &&
        ((x0 <= x1 && x1 <= x2) || (x0 >= x1 && x1 >= x2))
      )
        return `h${x2}`;

      return match;
    }
  );

  //left over "c" curves with no curve before it can be an s curve
  d = d.replace(
    /([h|v|l][^a-zA-Z]+)c\s*0\s*0\s*(-?\d+)\s*(-?\d+)\s*(-?\d+)\s*(-?\d+)/gm,
    "$1s$2 $3 $4 $5"
  );

  d = d.replace(/l0\s*(-?\d+)/gm, "v$1"); // line to vertical
  d = d.replace(/l(-?\d+) 0/gm, "h$1"); // line to horizontal

  /**
   * Sums the values of consecutive horizontal or vertical lines.
   * @param {string} hv - The command character ('h' for horizontal, 'v' for vertical).
   * @param {string} match - The matched string containing the commands and values.
   * @returns {string} - The summed command string.
   */
  const sumHV = (hv, match) => {
    const sum = match
      .split(hv)
      .filter(Boolean)
      .reduce((acc, num) => acc + parseFloat(num), 0);
    return `${hv}${sum}`;
  };

  d = d.replace(/h\d+(?:\s*h\d+)+/gm, match => sumHV("h", match)); // Sum positive horizontal lines
  d = d.replace(/v\d+(?:\s*v\d+)+/gm, match => sumHV("v", match)); // Sum positive vertical lines
  d = d.replace(/h-\d+(?:\s*h-\d+)+/gm, match => sumHV("h", match)); // Sum negative horizontal lines
  d = d.replace(/v-\d+(?:\s*v-\d+)+/gm, match => sumHV("v", match)); // Sum negative vertical lines

  d = d.replace(/(v|h)0(?![\d.])/gm, ""); // Remove "v" or "h" followed by the number 0, but not if followed by a digit or a decimal
  d = d.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers

  // Remove "z" commands that follow a "m" command
  d = d.replace(/(m[^a-y]+)z/gim, "$1");

  // Remove "m" at the end of the path
  d = d.replace(/m[^clshv]+$/gim, "");

  // merge consecutive "m" commands
  d = d.replace(/m[^clshvA-Z]+(?:\s*m[^clshvA-Z]+)+/gm, match => {
    const [...moves] = match.matchAll(/m\s*(?<x>-?\d+)\s*(?<y>-?\d+)/gim);
    let combinedMove = moves.reduce(
      (acc, move) => {
        const groups = move.groups || {};
        acc.x += parseFloat(groups.x);
        acc.y += parseFloat(groups.y);
        return acc;
      },
      { x: 0, y: 0 }
    );
    return `m${combinedMove.x} ${combinedMove.y}`;
  });

  if (options.devmode) {
    d = d.replace(/([a-zA-z])/gim, "\n$1"); // Add newline before commands
  }

  if (removeExtraCs) {
    d = d.replace(/c([^lshvzqmA-Z]*)/gms, match =>
      `c${match.replace(/c-/gms, "-")}`.replace(/cc/gms, "c")
    ); // Combine consecutive "c-" command codes
    d = d.replace(/l([^cshvzqmA-Z]*)/gms, match =>
      `l${match.replace(/l-/gms, "-")}`.replace(/ll/gms, "l")
    ); // Combine consecutive "l-" command codes
  }

  if (!options.devmode) {
    d = d.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers, after removing extra cs
  }

  return d;
};

// Remove all invisible elements
/**
 * Recursively retrieves the visibility properties (fill, stroke, stroke-width) of an SVG element by traversing up its parent chain.
 * @param {Element} element - The SVG element to retrieve visibility properties for.
 * @returns {{ fill: string, stroke: string, strokeWidth: number }} - The visibility properties of the element.
 */
const getVisibilityProperties = element => {
  // Look up the parent chain for stroke, fill, or stroke-width atrributes

  const parent = element.parentElement;

  let props = parent
    ? getVisibilityProperties(parent)
    : {
        fill: "black",
        stroke: "none",
        strokeWidth: 1
      };

  props.fill = element.getAttribute("fill") || props.fill;
  props.stroke = element.getAttribute("stroke") || props.stroke;
  props.strokeWidth = parseFloat(
    element.getAttribute("stroke-width") || props.strokeWidth.toString()
  );

  return props;
};

module.exports = { processPathD, getVisibilityProperties };
