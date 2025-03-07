//@ts-check

const removeExtraCs = true;
const convertToRelative = true;
const keepSmallerCommand = true;

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

  let scale = 1;

  if (pathElement) {
    // If the element is specified, scale the path data and stroke width
    d.match(/-?\d*\.?\d+/g)?.forEach(value => {
      const val = parseFloat(value);
      const decimalPlaces = Math.min(
        options.maxDecimalPlaces,
        (val.toString().split(".")[1] || "").length
      );
      scale = Math.max(scale, Math.pow(10, decimalPlaces));
    });
    if (scale !== 1) {
      pathElement.setAttribute(
        "transform",
        `scale(${(1 / scale).toString().replace(/^0\./, ".")})`
      );

      const props = getVisibilityProperties(pathElement);
      if (props.stroke !== "none" || pathElement.hasAttribute("stroke-width")) {
        pathElement.setAttribute(
          "stroke-width",
          (props.strokeWidth * scale).toString()
        );
      }
    }
  }

  // Simplify path data
  /** @type {string[]} */
  const allCommands = d.match(/[a-zA-Z][^a-zA-Z]*/g) || [];
  const pathData = allCommands.map(command => {
    const code = command.trim()[0];
    const commanddata = command.replace(code, "").trim();
    const originalcommand = `${code}${commanddata}`;

    /**
     * @type {{x?: number, y?: number}[]}
     */
    let coordinates = [];

    if (code.toLowerCase() === "h") {
      coordinates = [{ x: parseFloat(commanddata) }];
    } else if (code.toLowerCase() === "v") {
      coordinates = [{ y: parseFloat(commanddata) }];
    } else if (code.toLowerCase() === "z") {
      //
    } else {
      const pairs = [
        ...commanddata.matchAll(/(?<x>-?[.\d]+)\s*(?<y>-?[.\d]+)/g)
      ];

      coordinates = pairs.map(pair => {
        const groups = pair.groups || {};

        return { x: parseFloat(groups["x"]), y: parseFloat(groups["y"]) };
      });
    }

    return { code, coordinates, originalcommand, z: false };
  });

  //Do rounding here
  pathData.forEach(command => {
    command.coordinates.forEach(point => {
      if (point.x !== undefined) point.x = Math.round(point.x * scale) / scale;
      if (point.y !== undefined) point.y = Math.round(point.y * scale) / scale;
    });
  });

  const commandsizes = { c: 3, s: 2, l: 1, m: 1 };

  //Split "c" commands into groups of 3
  for (let i = 0; i < pathData.length; i++) {
    const code = pathData[i].code;
    const originalcommand = pathData[i].originalcommand;

    /** @type {number} */
    const commandsize = commandsizes[code];

    if (pathData[i].coordinates.length > commandsize) {
      const newCommands = [];
      for (let j = 0; j < pathData[i].coordinates.length; j += commandsize) {
        newCommands.push({
          code,
          coordinates: pathData[i].coordinates.slice(j, j + commandsize),
          originalcommand,
          z: false
        });
      }
      pathData.splice(i, 1, ...newCommands);
    }
  }

  if (convertToRelative) {
    const startLocation = { x: 0, y: 0 };
    const pointLocation = { x: 0, y: 0 };
    pathData.forEach((command, i) => {
      if (command.code.toLowerCase() === "z") {
        pointLocation.x = startLocation.x;
        pointLocation.y = startLocation.y;
      } else {
        const isAbsoluteCode = /[A-Z]/.test(command.code);

        // Convert absolute commands, except the first one, to relative
        if (isAbsoluteCode && i > 0) {
          command.code = command.code.toLowerCase();
          command.coordinates.forEach(point => {
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

      if (keepSmallerCommand) {
        const original = command.originalcommand + z;

        //Only use new command if it's shorter than the original
        return newCommand.length <= original.length ? newCommand : original;
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
    d = d.replace(/c([^lshvzmA-Z]*)/gms, match =>
      `c${match.replace(/c-/gms, "-")}`.replace(/cc/gms, "c")
    ); // Combine consecutive "c-" command codes
    d = d.replace(/l([^cshvzmA-Z]*)/gms, match =>
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
