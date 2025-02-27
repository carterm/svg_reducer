//@ts-check
const fs = require("node:fs");
const path = require("node:path");
const chalk = require("chalk");
const { JSDOM } = require("jsdom");
const devmode = true;
const maxDecimalPlaces = 2;
const removeExtraCs = true;
const convertToRelative = true;

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

    // Parse the transformed data as HTML
    const dom = new JSDOM(data);
    const document = dom.window.document;

    const svgElement = document.querySelector("svg");
    if (!svgElement) {
      console.error(`Missing SVG element`);
      process.exit(1);
    }

    svgElement.removeAttribute("id");
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
            svgElement
              .querySelectorAll(rule["selectorText"])
              .forEach(element => {
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

    // Merge all path elements with matching attributes (ignore "d" attribute) and first letter in "d" attribute is uppercase
    const pathsToMerge = [...svgElement.querySelectorAll("path")];
    for (let i = 1; i < pathsToMerge.length; i++) {
      const previousPath = pathsToMerge[i - 1];
      const currentPath = pathsToMerge[i];

      if (
        // Do both paths have the same attributes? Except for d
        [...previousPath.attributes].every(
          attr =>
            attr.name === "d" ||
            currentPath.getAttribute(attr.name) === attr.value
        )
      ) {
        previousPath.setAttribute(
          "d",
          `${previousPath.getAttribute("d")}\n${currentPath.getAttribute("d")}`
        );
        currentPath.remove();
      }
    }

    svgElement.querySelectorAll("path").forEach(pathElement => {
      // pull out style elements to make attributes
      Array.from(pathElement.style).forEach(attr => {
        if (pathElement.style[attr]) {
          pathElement.setAttribute(attr, pathElement.style[attr]);
          pathElement.style.removeProperty(attr);
        }
      });

      if (!pathElement.style.length) {
        pathElement.removeAttribute("style");
      }

      let d = pathElement.getAttribute("d") || "";

      d = d.replace(/,/g, " "); // Replace commas with spaces
      d = d.replace(/(\.\d+)(?=(\.\d+))/g, "$1 "); // Add space between decimals

      d = d.replace(/\s+([clshvm])/gim, "$1"); // Remove leading whitespace before commands
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

        const strokeWidth = pathElement.getAttribute("stroke-width");
        if (strokeWidth) {
          pathElement.setAttribute(
            "stroke-width",
            (parseFloat(strokeWidth) * scale).toString()
          );
        }
      }

      d = d.replace(/-?\d*\.?\d+/g, match =>
        Math.round((parseFloat(match) * 10 * scale) / 10).toString()
      ); // Round decimals

      //Switch to relative commands
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

        return { code, coordinates, originalcommand };
      });

      const commandsizes = { c: 3, s: 2, q: 2, t: 1, a: 7, l: 1 };

      //Split "c" commands into groups of 3
      for (let i = 0; i < pathData.length; i++) {
        const code = pathData[i].code.toLowerCase();
        const originalcommand = pathData[i].originalcommand;

        /** @type {number} */
        const commandsize = commandsizes[code];

        if (pathData[i].coordinates.length > commandsize) {
          const newCommands = [];
          for (
            let j = 0;
            j < pathData[i].coordinates.length;
            j += commandsize
          ) {
            newCommands.push({
              code,
              coordinates: pathData[i].coordinates.slice(j, j + commandsize),
              originalcommand
            });
          }
          pathData.splice(i, 1, ...newCommands);
        }
      }

      if (convertToRelative) {
        const pointLocation = { x: 0, y: 0 };
        pathData
          .filter(x => x.code.toLowerCase() !== "z")
          .forEach(command => {
            const isAbsoluteCode = /[A-Z]/.test(command.code);

            command.code = command.code.toLowerCase();
            command.coordinates.forEach(point => {
              if (isAbsoluteCode) {
                if (point.x) point.x -= pointLocation.x;
                if (point.y) point.y -= pointLocation.y;
              }
            });

            const lastpoint =
              command.coordinates[command.coordinates.length - 1];

            if (lastpoint?.x) pointLocation.x += lastpoint.x;
            if (lastpoint?.y) pointLocation.y += lastpoint.y;
          });
      }

      // render simplified path data
      d = pathData
        .map(command => {
          const code = command.code;
          const coordinates = command.coordinates.map(point =>
            `${point.x ?? ""} ${point.y ?? ""}`.trim()
          ); // Convert coordinates back to string
          const newCommand = `${code}${coordinates.join(" ")}`.replace(
            / -/g,
            "-"
          ); // Remove space before negative numbers

          //Only use new command if it's shorter than the original
          return newCommand.length <= command.originalcommand.length
            ? newCommand
            : command.originalcommand;
        })
        .join("");

      d = d.replace(/s0 0 0 0(?![\d.])/gim, ""); // Remove "s" followed by 0 0 0 0, but not if followed by a digit or a decimal
      d = d.replace(/m[^clshvz]*(m)/gim, "$1"); // Remove consecutive "M" commands

      d = d.replace(/c\s*-?\d+\s+0\s*-?\d+\s+0\s*(-?\d+)\s+0/gm, "h$1"); //negative horizontal line
      d = d.replace(/c\s*0\s*-?\d+\s+0\s*-?\d+\s+0\s*(-?\d+)/gm, "v$1"); //negative vertical line

      d = d.replace(/c0 0 0 0\s*(-?\d+)\s*(-?\d+)/gm, "l$1 $2"); // line

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

      pathElement.removeAttribute("d");
      pathElement.setAttribute("d", d);
    }); //End Path loop

    // Push common attributes to "g" elements
    svgElement.querySelectorAll("path, polygon").forEach(targetElement => {
      const siblings = [
        ...(targetElement.parentElement?.children || [])
      ].filter(x => x !== targetElement);

      [...targetElement.attributes].forEach(attr => {
        // Search for a sibling with the same attribute value
        const matchingSiblings = siblings.filter(
          sibling => sibling.getAttribute(attr.name) === attr.value
        );

        if (matchingSiblings.length) {
          const newG = document.createElement("g");
          newG.setAttribute(attr.name, attr.value);
          targetElement.parentElement?.insertBefore(newG, targetElement);

          [targetElement, ...matchingSiblings].forEach(sibling => {
            sibling.removeAttribute(attr.name);

            newG.appendChild(sibling);
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
          parent?.tagName.toLowerCase() === "g" &&
          parent.childElementCount === 1
        ) {
          gChangeDone = false;
          [...gElement.attributes].forEach(attr => {
            parent.setAttribute(attr.name, attr.value);
          });
          while (gElement.firstChild) parent.appendChild(gElement.firstChild);

          gElement.remove();
        }
      });
    }

    // Serialize the SVG element
    const htmlOutput = svgElement.outerHTML;

    const transformedData = htmlOutput
      // .replace(/\r?\n|\r/g, "") // Remove line breaks

      .replace(/\s{2,}/g, " ") // Replace 2 or more whitespace chars with a single space
      .replace(/>\s+</g, "><") // Remove all whitespace between ">" and "<"
      .replace(/><\/path>/g, "/>");
    // Write to the output file
    fs.writeFile(outputFile, transformedData, "utf8", writeErr => {
      if (writeErr) {
        console.error(`Error writing the output file: ${writeErr.message}`);
        process.exit(1);
      }
      console.log(`Successfully transformed and saved to ${outputFile}`);
      console.log(
        `Original file size: \t${chalk.blue(data.length.toLocaleString())} bytes`
      );
      console.log(
        `Transformed file size: \t${chalk.green(transformedData.length.toLocaleString())} bytes`
      );
      const reductionPercent =
        ((data.length - transformedData.length) / data.length) * 100;
      console.log(
        `Reduction: \t\t${chalk.yellow(reductionPercent.toFixed(2))}%`
      );
    });
  });
});
