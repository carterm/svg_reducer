//@ts-check

const removeExtraCs = true;
const convertToRelative = true;
const keepSmallerCommand = true;
const scalepoints = true;

/**
 *
 * @param {string} pathD
 * @param {import("./process-svg.cjs").processDataOptions} options
 * @param {SVGPathElement} [pathElement]
 */
const processPathD = (pathD, options, pathElement) => {
  pathD = pathD.replace(/,/g, " "); // Replace commas with spaces
  pathD = pathD.replace(/(\.\d+)(?=(\.\d+))/g, "$1 "); // Add space between decimals

  pathD = pathD.replace(/\s+([clshvmza])/gim, "$1"); // Remove leading whitespace before commands
  pathD = pathD.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers

  // Simplify path data
  /** @type {string[]} */
  const allCommands = pathD.match(/[a-zA-Z][^a-zA-Z]*/g) || [];
  const pathData = allCommands.map(command => {
    const code = command.trim()[0];
    const commanddata = command.replace(code, "").trim();

    //Collect all the digits in the command
    const digits = [...commanddata.matchAll(/\s*-?[.\d]+\s*/g)].map(x =>
      parseFloat(x[0])
    );

    /**
     * @type {{noscale?: boolean, notxy?: boolean, x?: number, y?: number, absx?: number, absy?: number}[]}
     */
    let coordinates = [];

    switch (code.toLowerCase()) {
      case "h":
        coordinates = digits.map(x => ({ x }));
        break;
      case "v":
        coordinates = digits.map(y => ({ y }));
        break;
      case "a":
        for (let i = 0; i < digits.length; i += 7) {
          coordinates.push(
            { x: digits[i + 0], y: digits[i + 1], notxy: true },
            { x: digits[i + 2], noscale: true, notxy: true },
            { x: digits[i + 3], noscale: true, notxy: true },
            { x: digits[i + 4], noscale: true, notxy: true },
            { x: digits[i + 5], y: digits[i + 6] }
          );
        }
        break;
      case "z":
        // Nothing to do, "z" has no coordinates
        break;
      default:
        for (let i = 0; i < digits.length; i += 2)
          if (i + 1 < digits.length)
            // Check to ensure there is a pair
            coordinates.push({ x: digits[i], y: digits[i + 1] });
    }

    return { code, coordinates, z: false, abs: /[A-Z]/.test(code) };
  });

  /** @type {Record<string, number>} */
  const commandsizes = { c: 3, q: 2, s: 2, l: 1, m: 1, h: 1, v: 1, a: 5 };

  //Split "c" commands into groups of 3
  for (let i = 0; i < pathData.length; i++) {
    const command = pathData[i];
    let code = command.code;

    /** @type {number?} */
    const commandsize = commandsizes[code.toLowerCase()];
    if (commandsize) {
      const coordinates = command.coordinates;

      if (coordinates.length > commandsize) {
        const newCommands = [];
        for (let j = 0; j < coordinates.length; j += commandsize)
          newCommands.push({
            code,
            coordinates: coordinates.slice(j, j + commandsize),
            z: false,
            abs: command.abs
          });

        if (newCommands.length > 1 && code.toLowerCase() === "m")
          // convert subsequent movetos to linetos
          for (let k = 1; k < newCommands.length; k++) {
            newCommands[k].code = code === "m" ? "l" : "L";
          }

        pathData.splice(i, 1, ...newCommands);
      }
    }
  }

  if (pathData[0].code === "m") {
    // If the first command is a moveto, ensure it's absolute to simplify processing
    pathData[0].code = "M";
    pathData[0].abs = true;
  }

  if (scalepoints) {
    // find scale
    let scale = options.scaleAll || 1;
    if (pathElement && scale === 1)
      pathData.forEach(command =>
        // If the element is specified, scale the path data and stroke width

        // Find the most decimal places in the path data
        command.coordinates.forEach(point =>
          [point.x, point.y].forEach(val => {
            const decimalPlaces = Math.min(
              options.maxDecimalPlaces,
              (val?.toString().split(".")[1] || "").length
            );
            scale = Math.max(scale, Math.pow(10, decimalPlaces));
          })
        )
      );

    if (pathElement && scale !== 1) {
      pathElement.setAttribute(
        "transform",
        `scale(${(1 / scale).toString().replace(/^0\./, ".")})`
      );

      const props = getVisibilityProperties(pathElement);
      if (props.stroke !== "none" || pathElement.hasAttribute("stroke-width"))
        pathElement.setAttribute(
          "stroke-width",
          (props.strokeWidth * scale).toString()
        );

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
          if (transform?.startsWith("matrix")) {
            const match = transform.match(/matrix\(([^)]+)\)/);
            if (match) {
              //Apply the gradientTransform to the gradient coordinates
              const coordinateNames = ["x1", "y1", "x2", "y2"];

              const [x1, y1, x2, y2] = coordinateNames
                .map(field => gradient.getAttribute(field))
                .filter(x => x !== null)
                .map(parseFloat);

              const [a, b, c, d, e, f] = match[1].split(" ").map(parseFloat);

              // Apply the matrix transformation to each coordinate
              const newX1 = a * x1 + c * y1 + e;
              const newY1 = b * x1 + d * y1 + f;
              const newX2 = a * x2 + c * y2 + e;
              const newY2 = b * x2 + d * y2 + f;

              // Update the gradient with the transformed coordinates
              [newX1, newY1, newX2, newY2].forEach((val, i) =>
                gradient.setAttribute(coordinateNames[i], val.toFixed(0))
              );

              // Remove the gradientTransform attribute as it's now applied
              gradient.removeAttribute("gradientTransform");
            }
          }

          if (!gradient.hasAttribute("data-scaled")) {
            gradient.setAttribute("data-scaled", "true");
            // No Transform, Scale the x1, y1, x2, y2 attributes
            [...gradient.attributes]
              .filter(attr => ["x1", "y1", "x2", "y2"].includes(attr.name))
              .forEach(
                attr =>
                  (attr.value = (parseFloat(attr.value) * scale).toString())
              );
          }
        }
      }
    }
    // scale is determined.  Round and scale
    pathData.forEach(command =>
      command.coordinates.forEach(point => {
        if (point.noscale) return;
        if (pathElement) {
          if (point.x !== undefined) point.x = Math.round(point.x * scale);
          if (point.y !== undefined) point.y = Math.round(point.y * scale);
        } else {
          if (options.maxDecimalPlaces === 0) return;
          const scaleFactor = Math.pow(options.maxDecimalPlaces, 10);

          if (point.x !== undefined)
            point.x = Math.round(point.x * scaleFactor) / scaleFactor;
          if (point.y !== undefined)
            point.y = Math.round(point.y * scaleFactor) / scaleFactor;
        }
      })
    );
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

          command.coordinates
            .filter(point => !point.notxy)
            .forEach(point => {
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

  // convert "c" commands with a wasted control point to "q" commands
  const isZero = (/** @type {number} */ n) => Math.abs(n) < 0.001;
  pathData
    .filter(command => command.code === "c")
    .forEach(command => {
      const [p1, p2, p3] = /** @type {{x: number, y: number}[]} */ (
        command.coordinates
      );

      // Case 1: CP1 is wasted (c0 0 ...)
      if (isZero(p1.x) && isZero(p1.y)) {
        command.code = "q";
        command.coordinates = [p2, p3];
      } else if (isZero(p2.x - p3.x) && isZero(p2.y - p3.y)) {
        // Case 2: CP2 is wasted (... x2 y2 == x y)
        const mag1 = Math.hypot(p1.x, p1.y);
        const mag2 = Math.hypot(p2.x, p2.y);

        if (mag1 === 0 || mag2 === 0) return;

        const dot = p1.x * p2.x + p1.y * p2.y;
        const cosAngle = dot / (mag1 * mag2);

        // More permissive thresholds (≈50° allowed)
        const angleAligned = cosAngle >= 0.65;
        const lengthOk = mag1 / mag2 <= 1.1;

        if (angleAligned && lengthOk) {
          command.code = "q";
          command.coordinates = [p1, p3];
        }
      }
    });

  // convert "c","s","q" commands with no curve to "l" commands
  const eps = 1e-6;
  const col = (
    /** @type {number } */ a,
    /** @type {number } */ b,
    /** @type {number } */ c,
    /** @type {number } */ d
  ) => Math.abs(a * d - b * c) < eps;

  pathData.forEach(command => {
    switch (command.code) {
      case "c": {
        const [p1, p2, p3] = /** @type {{x: number, y: number}[]} **/ (
          command.coordinates
        );

        const col1 = col(p1.x, p1.y, p3.x, p3.y);
        const col2 = col(p2.x, p2.y, p3.x, p3.y);

        if (col1 && col2) {
          command.code = "l";
          command.coordinates = [p3];
        }
        break;
      }
      case "s":
      case "q": {
        const [p1, p2] = /** @type {{x: number, y: number}[]} **/ (
          command.coordinates
        );

        if (col(p1.x, p1.y, p2.x, p2.y)) {
          command.code = "l";
          command.coordinates = [p2];
        }
        break;
      }
    }
  });

  // convert "c" commands with first control point at (0,0) to "s" commands
  pathData
    .filter(command => command.code === "c")
    .forEach((command, i) => {
      const [p1, p2, p3] = command.coordinates;

      const prev = pathData[i - 1];

      const prevIsCurve = prev && (prev.code === "c" || prev.code === "s");

      // Only convert if previous is NOT a curve
      // and first control point is (0,0)
      if (!prevIsCurve && p1.x === 0 && p1.y === 0) {
        command.code = "s";
        command.coordinates = [p2, p3];
      }
    });

  //convert "l" commands with only one coordinate to "h" or "v" commands
  pathData
    .filter(command => command.code === "l")
    .forEach(command => {
      const [p] = /** @type {{x: number, y: number}[]} **/ (
        command.coordinates
      );

      if (Math.abs(p.y) < eps) {
        command.code = "h";
        command.coordinates = [{ x: p.x }];
      } else if (Math.abs(p.x) < eps) {
        command.code = "v";
        command.coordinates = [{ y: p.y }];
      }
    });

  // Merge consecutive "h" or "v" commands
  for (let i = 1; i < pathData.length; i++) {
    const prev = pathData[i - 1];
    const curr = pathData[i];

    const prevCoord =
      /** @type {{x: number, y: number, absx?: number, absy?: number}} */ (
        prev.coordinates[0]
      );
    const currCoord =
      /** @type {{x: number, y: number, absx?: number, absy?: number}} */ (
        curr.coordinates[0]
      );

    // merge horizontal lines
    if (prev.code === "h" && curr.code === "h") {
      prevCoord.x += currCoord.x;

      if (prevCoord.absx) prevCoord.absx += currCoord.x;

      pathData.splice(i, 1);
      i--;
      continue;
    }

    // merge vertical lines
    if (prev.code === "v" && curr.code === "v") {
      prevCoord.y += currCoord.y;
      if (prevCoord.absy) prevCoord.absy += currCoord.y;

      pathData.splice(i, 1);
      i--;
      continue;
    }
  }

  // Do some cleanup before rending the simplified path data
  for (let i = 1; i < pathData.length; i++) {
    const command = pathData[i];

    if (command.code.toLowerCase() === "z") {
      pathData[i - 1].z = true;
      pathData.splice(i, 1);
      i--;
      continue;
    }

    // remove "v0" and "h0" commands
    if (
      (command.code === "h" && command.coordinates[0].x === 0) ||
      (command.code === "v" && command.coordinates[0].y === 0)
    ) {
      pathData.splice(i, 1);
      i--;
      continue;
    }
  }

  // Merge consecutive movetos
  for (let i = 1; i < pathData.length; i++) {
    const prev = pathData[i - 1];
    const curr = pathData[i];
    const prevCoord =
      /** @type {{x: number, y: number, absx?: number, absy?: number}} */ (
        prev.coordinates[0]
      );
    const currCoord =
      /** @type {{x: number, y: number, absx?: number, absy?: number}} */ (
        curr.coordinates[0]
      );

    //  m followed by m → sum them
    if (prev.code === "m" && curr.code === "m") {
      prevCoord.x += currCoord.x;
      prevCoord.y += currCoord.y;
      pathData.splice(i, 1);
      i--;
      continue;
    }
  }

  // No "z" on moves
  pathData
    .filter(command => command.code.toLowerCase() === "m")
    .forEach(command => {
      command.z = false;
    });

  // render simplified path data
  pathD = pathData
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
      } else return newCommand;
    })
    .join("");

  // Remove "m" at the end of the path
  pathD = pathD.replace(/m[^clshvaq]+$/gim, "");

  if (pathElement && (pathD.endsWith("z") || pathD.endsWith("Z"))) {
    // remove final z if the path has no stroke
    const props = getVisibilityProperties(pathElement);
    if (props.stroke === "none" || props.fill !== "none")
      pathD = pathD.replace(/z$/i, "");
  }

  if (options.devmode) pathD = pathD.replace(/([a-zA-z])/gim, "\n$1"); // Add newline before commands

  if (removeExtraCs) {
    pathD = pathD.replace(/c([^lshvzqmaA-Z]*)/gms, match =>
      `c${match.replace(/c-/gms, "-")}`.replace(/cc/gms, "c")
    ); // Combine consecutive "c-" command codes
    pathD = pathD.replace(/l([^cshvzqmaA-Z]*)/gms, match =>
      `l${match.replace(/l-/gms, "-")}`.replace(/ll/gms, "l")
    ); // Combine consecutive "l-" command codes
  }

  if (!options.devmode) pathD = pathD.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers, after removing extra cs

  return pathD;
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
