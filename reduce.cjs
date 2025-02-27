//@ts-check
const fs = require("node:fs");
const path = require("node:path");
const chalk = require("chalk");
const { JSDOM } = require("jsdom");
const devmode = true;
const maxDecimalPlaces = 2;

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
                element.setAttribute("style", rule["style"].cssText);
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

    [...svgElement.querySelectorAll("path")].forEach(pathElement => {
      // pull out style elements to make attributes
      if (pathElement.style.fill) {
        pathElement.setAttribute("fill", pathElement.style.fill);
        pathElement.style.removeProperty("fill");
      }

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
      const allCommands = d.match(/[a-zA-Z][^a-zA-Z]+/g) || [];
      const pathData = allCommands.map(command => {
        const code = command[0];
        const commanddata = command.slice(1).trim();

        /**
         * @type {{x?: number, y?: number}[]}
         */
        let coordinates = [];

        if (code.toLowerCase() === "h") {
          coordinates = [{ x: parseInt(commanddata) }];
        } else if (code.toLowerCase() === "v") {
          coordinates = [{ y: parseInt(commanddata) }];
        } else {
          /** @type {string[]} */
          const pairs = commanddata.match(/(-?\d+)\s*(-?\d+)/g) || [];
          coordinates = pairs.map(pair => {
            const coords = pair.split(" ");

            return { x: parseInt(coords[0]), y: parseInt(coords[1]) };
          });
        }

        return { code, coordinates };
      });

      const pointLocation = { x: 0, y: 0 };
      pathData.forEach(command => {
        const isAbsoluteCode = /[A-Z]/.test(command.code);

        command.code = command.code.toLowerCase();
        command.coordinates.forEach(point => {
          if (isAbsoluteCode) {
            if (point.x) point.x -= pointLocation.x;
            if (point.y) point.y -= pointLocation.y;
          }
          if (point.x) pointLocation.x += point.x;
          if (point.y) pointLocation.y += point.y;
        });
      });

      d = pathData
        .map(command => {
          const code = command.code;
          const coordinates = command.coordinates.map(point => {
            return `${point.x} ${point.y}`;
          }); // Convert coordinates back to string
          return `${code}${coordinates.join(" ")}`;
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
        d = d.replace(/([clshvm])/gim, "\n$1"); // Add newline before commands
      }

      d = d.replace(/c([^lshvzCLSHVZ]*)/gms, match =>
        `c${match.replace(/c-/gms, "-")}`.replace(/cc/gms, "c")
      ); // Combine consecutive "c-" command codes

      if (!devmode) {
        d = d.replace(/\s+-/gm, "-"); // Remove whitespace before negative numbers, after removing extra cs
      }

      pathElement.removeAttribute("d");
      pathElement.setAttribute("d", d);
    });

    // Push common attributes to "g" elements
    [...svgElement.querySelectorAll("path, polygon")].forEach(targetElement => {
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
    });

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
