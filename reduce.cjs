//@ts-check
const fs = require("node:fs");
const path = require("node:path");
const chalk = require("chalk");
const { JSDOM } = require("jsdom");
const devmode = true;
const maxDecimalPlaces = 2;
const removeExtraCs = true;
const convertToRelative = true;
const mergePaths = true;
const keepSmallerCommand = true;

// Get command line arguments
const args = process.argv.slice(2);

// Check if correct number of arguments are provided
if (args.length < 1) {
  console.error("Please provide an input file.");
  process.exit(1);
}

const inputFile = args[0];
const outputFile =
  args.length > 1
    ? args[1]
    : path.join(path.dirname(inputFile), "output", path.basename(inputFile));

// Create the necessary directories if they don't exist
const outputDir = path.dirname(outputFile);

const shareableAttributes = ["stroke", "stroke-width", "fill", "transform"];

const processData = (/** @type {string} */ data) => {
  // Parse the transformed data as HTML
  const dom = new JSDOM(data);
  const document = dom.window.document;

  const svgElement = document.querySelector("svg");
  if (!svgElement) {
    console.error(`Missing SVG element`);
    process.exit(1);
  }

  document
    .querySelectorAll("*")
    .forEach(element => element.removeAttribute("id"));
  svgElement.removeAttribute("data-name");
  ["x", "y"].forEach(attr => {
    if (["0", "0px"].includes(svgElement.getAttribute(attr) || "")) {
      svgElement.removeAttribute(attr);
    }
  });
  svgElement.removeAttribute("xml:space");
  svgElement.removeAttribute("xmlns:xlink");
  svgElement.style.removeProperty("enable-background");

  if (svgElement.getAttribute("style") === "") {
    svgElement.removeAttribute("style");
  }

  const styletags = svgElement.querySelectorAll("style");
  styletags.forEach(styletag => {
    const styleDOM = new JSDOM(
      `<!DOCTYPE html><html><head>${styletag.outerHTML}</head></html>`
    );

    [...styleDOM.window.document.styleSheets].forEach(styleSheet => {
      [...styleSheet.cssRules].forEach(rule => {
        if (rule.cssText) {
          svgElement.querySelectorAll(rule["selectorText"]).forEach(element => {
            element.setAttribute(
              "style",
              element.style.cssText + rule["style"].cssText
            );
          });
        }
      });
    });
    styletag.remove();
  });

  // Remove all classes, since the stylesheets have been removed
  svgElement.querySelectorAll("[class]").forEach(element => {
    element.removeAttribute("class");
  });

  // pull out style elements to make attributes
  /** @type {HTMLElement[]} */
  ([...svgElement.querySelectorAll("*")]).forEach(pathElement => {
    Array.from(pathElement.style).forEach(attr => {
      if (pathElement.style[attr]) {
        pathElement.setAttribute(attr, pathElement.style[attr]);
        pathElement.style.removeProperty(attr);
      }
    });

    if (!pathElement.style.length) {
      pathElement.removeAttribute("style");
    }
  });

  //Convert lines to paths
  [...svgElement.querySelectorAll("line")].forEach(lineElement => {
    const pathElement = /** @type {SVGPathElement} */ (
      /** @type {unknown} */ (document.createElement("path"))
    );

    pathElement.setAttribute(
      "d",
      `M${lineElement.getAttribute("x1")} ${lineElement.getAttribute("y1")}L${lineElement.getAttribute("x2")} ${lineElement.getAttribute("y2")}`
    );
    [...lineElement.attributes].forEach(attr => {
      if (shareableAttributes.includes(attr.name)) {
        pathElement.setAttribute(attr.name, attr.value);
      }
    });

    lineElement.parentElement?.insertBefore(pathElement, lineElement);
    lineElement.remove();
  });

  //Convert simple rects to paths
  [...svgElement.querySelectorAll("rect")].forEach(rectElement => {
    const pathElement = /** @type {SVGPathElement} */ (
      /** @type {unknown} */ (document.createElement("path"))
    );

    if (!rectElement.getAttribute("rx") && !rectElement.getAttribute("ry")) {
      // Simple rectangle
      //<rect fill="black" width="149.31" height="83.66" />
      // to...
      //<path fill="black" d="M0 0 H149.31 V83.66 H0 Z" />

      const [rectWidth, rectHeight, rectX, rectY] = [
        "width",
        "height",
        "x",
        "y"
      ].map(attr => {
        const value = parseFloat(rectElement.getAttribute(attr) || "0");
        return isNaN(value) ? 0 : value;
      });

      pathElement.setAttribute(
        "d",
        `M${rectX} ${rectY}H${rectX + rectWidth}V${rectY + rectHeight}H${rectX}Z`
      );

      [...rectElement.attributes].forEach(attr => {
        if (shareableAttributes.includes(attr.name)) {
          pathElement.setAttribute(attr.name, attr.value);
        }
      });

      rectElement.parentElement?.insertBefore(pathElement, rectElement);
      rectElement.remove();
    }
  });

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
          fill: "none",
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

  // Look up the parent chain for stroke, fill, or stroke-width atrributes
  [...svgElement.querySelectorAll("path")].forEach(element => {
    const props = getVisibilityProperties(element);
    if (
      props.fill === "none" &&
      (props.stroke === "none" || props.strokeWidth === 0)
    ) {
      element.remove();
    }
  });

  if (mergePaths) {
    // Merge all path elements with matching attributes (ignore "d" attribute) and first letter in "d" attribute is uppercase
    const pathsToMerge = [...svgElement.querySelectorAll("path")];
    for (let i = 0; i < pathsToMerge.length - 1; i++) {
      const nextPath = pathsToMerge[i + 1];
      const currentPath = pathsToMerge[i];

      if (
        // Do both paths have the same attributes? Except for d
        [
          ...new Set(
            [...nextPath.attributes, ...currentPath.attributes].map(
              attr => attr.name
            )
          )
        ]
          .filter(name => name !== "d")
          .every(
            name =>
              currentPath.getAttribute(name) === nextPath.getAttribute(name)
          )
      ) {
        //Make sure the first M command is uppercase when merging
        const nextD = (nextPath.getAttribute("d") || "").replace(/m/, "M");

        nextPath.setAttribute(
          "d",
          `${currentPath.getAttribute("d")}\n${nextD}`
        );
        currentPath.remove();
      }
    }
  }

  // Process all remaining path statements
  svgElement.querySelectorAll("path").forEach(pathElement => {
    let d = pathElement.getAttribute("d") || "";

    d = d.replace(/,/g, " "); // Replace commas with spaces
    d = d.replace(/(\.\d+)(?=(\.\d+))/g, "$1 "); // Add space between decimals

    d = d.replace(/\s+([clshvmz])/gim, "$1"); // Remove leading whitespace before commands
    d = d.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers

    let scale = 1;
    d.match(/-?\d*\.?\d+/g)?.forEach(value => {
      const val = parseFloat(value);
      const decimalPlaces = Math.min(
        maxDecimalPlaces,
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

    d = d.replace(/-?\d*\.?\d+/g, match =>
      Math.round((parseFloat(match) * 10 * scale) / 10).toString()
    ); // Round decimals

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
        coordinates = [{ x: parseInt(commanddata) }];
      } else if (code.toLowerCase() === "v") {
        coordinates = [{ y: parseInt(commanddata) }];
      } else if (code.toLowerCase() === "z") {
        //
      } else {
        const pairs = [...commanddata.matchAll(/(?<x>-?\d+)\s*(?<y>-?\d+)/g)];

        coordinates = pairs.map(pair => {
          const groups = pair.groups || {};

          return { x: parseInt(groups["x"]), y: parseInt(groups["y"]) };
        });
      }

      return { code, coordinates, originalcommand, z: false };
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

    if (devmode) {
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

    if (!devmode) {
      d = d.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers, after removing extra cs
    }

    pathElement.setAttribute("d", d);
  }); //End Path loop

  // Push common attributes to "g" elements
  svgElement.querySelectorAll("*").forEach(targetElement => {
    [...targetElement.attributes]
      .filter(attr => shareableAttributes.includes(attr.name))
      .forEach(attr => {
        // Search for a sibling with the same attribute value
        const matchingSiblings = [];
        let sibling = targetElement.nextElementSibling;

        while (sibling?.getAttribute(attr.name) === attr.value) {
          matchingSiblings.push(sibling);
          sibling = sibling.nextElementSibling;
        }

        if (matchingSiblings.length) {
          const newG = document.createElement("g");
          newG.setAttribute(attr.name, attr.value);
          targetElement.parentElement?.insertBefore(newG, targetElement);

          [targetElement, ...matchingSiblings].forEach(sibling2 => {
            sibling2.removeAttribute(attr.name);

            newG.appendChild(sibling2);
          });
        }
      });
  }); //End push to common attributes

  // Remove empty tags from dom
  svgElement.querySelectorAll("*").forEach(element => {
    if (!element.hasAttributes() && !element.innerHTML.trim().length) {
      element.remove();
    }
  });

  // Merge nested "g" elements
  let gChangeDone = false;
  while (!gChangeDone) {
    gChangeDone = true;
    document.querySelectorAll("g").forEach(gElement => {
      const parent = gElement.parentElement;
      if (
        // If the parent is a "g" element and has only one child or no attributes
        parent &&
        (parent.childElementCount === 1 || gElement.attributes.length === 0)
      ) {
        // Move the attributes and children of the child "g" element to the parent "g" element
        gChangeDone = false;
        [...gElement.attributes].forEach(attr => {
          parent.setAttribute(attr.name, attr.value);
        });
        while (gElement.firstChild) parent.appendChild(gElement.firstChild);

        gElement.remove();
      }
    });
  }

  // Remove "g" elements with only one child
  document.querySelectorAll("g > *:only-child").forEach(onlychild => {
    const gElement = onlychild.parentElement;
    if (gElement?.parentElement) {
      [...gElement.attributes].forEach(attr => {
        onlychild.setAttribute(attr.name, attr.value);
      });
      gElement.parentElement.insertBefore(onlychild, gElement);
      gElement.remove();
    }
  });

  // put path "d" attributes in the correct order
  document.querySelectorAll("path").forEach(pathElement => {
    const d = pathElement.getAttribute("d");
    if (d) {
      pathElement.removeAttribute("d");
      pathElement.setAttribute("d", d);
    }
  });

  // apply the transform to the SVG viewbox if all children have the same scale transform
  const svgChildren = [...svgElement.children];
  if (
    svgChildren
      .map(x => x.getAttribute("transform"))
      .every((transform, _i, a) => transform === a[0])
  ) {
    // Check if the transform is only a scale transform
    const transform = svgChildren[0].getAttribute("transform");
    if (transform) {
      const scaleMatch = transform.match(/scale\((?<val>[^)]+)\)/);

      // Check if the transform is only a scale transform
      if (
        scaleMatch &&
        transform.replace(scaleMatch[0], "").trim().length === 0
      ) {
        const viewbox = svgElement.getAttribute("viewBox");
        const val = scaleMatch.groups?.val;
        if (val && viewbox) {
          const [x, y, width, height] = viewbox.split(" ").map(parseFloat);

          // Update the viewBox to reflect the new scale
          const scale = parseFloat(val);
          svgElement.setAttribute(
            "viewBox",
            `${x / scale} ${y / scale} ${width / scale} ${height / scale}`
          );

          svgChildren.forEach(child => {
            // Remove the scale transform from the child
            child.removeAttribute("transform");
          });
        }
      }
    }
  }

  // Return serialized HTML
  return (
    svgElement.outerHTML
      // .replace(/\r?\n|\r/g, "") // Remove line breaks

      .replace(/\s{2,}/g, " ") // Replace 2 or more whitespace chars with a single space
      .replace(/>\s+</g, "><") // Remove all whitespace between ">" and "<"
      .replace(/><\/(path|line|rect)>/g, "/>")
  );
};

fs.mkdir(outputDir, { recursive: true }, mkdirErr => {
  if (mkdirErr) {
    console.error(`Error creating directory: ${mkdirErr.message}`);
    process.exit(1);
  }

  // Read the input file
  fs.readFile(inputFile, "utf8", (readErr, data) => {
    if (readErr) {
      console.error(`Error reading the input file: ${readErr.message}`);
      process.exit(1);
    }

    const htmlOutput = processData(data);

    // Write to the output file
    fs.writeFile(outputFile, htmlOutput, "utf8", writeErr => {
      if (writeErr) {
        console.error(`Error writing the output file: ${writeErr.message}`);
        process.exit(1);
      }
      console.log(`Successfully transformed and saved to ${outputFile}`);
      console.log(
        `Original file size: \t${chalk.blue(data.length.toLocaleString())} bytes`
      );
      console.log(
        `Transformed file size: \t${chalk.green(htmlOutput.length.toLocaleString())} bytes`
      );
      const reductionPercent =
        ((data.length - htmlOutput.length) / data.length) * 100;
      console.log(
        `Reduction: \t\t${chalk.yellow(reductionPercent.toFixed(2))}%`
      );
    });
  });
});
