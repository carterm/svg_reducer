//@ts-check
const fs = require("node:fs");
const path = require("node:path");
const chalk = require("chalk");
const { JSDOM } = require("jsdom");

// Get command line arguments
const args = process.argv.slice(2);

// Check if correct number of arguments are provided
if (args.length !== 2) {
  console.error("Please provide an input file and an output file.");
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1];

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

    [...svgElement.querySelectorAll("path")].forEach(pathElement => {
      let d = pathElement.getAttribute("d");
      if (!d) return;

      d = d.replace(/,/g, " "); // Replace commas with spaces
      d = d.replace(/(\.\d+)(?=(\.\d+))/g, "$1 "); // Add space between decimals

      let scale = 1;
      d.match(/-?\d*\.?\d+/g)?.forEach(value => {
        const val = parseFloat(value);
        const decimalPlaces = (val.toString().split(".")[1] || "").length;
        scale = Math.max(scale, Math.pow(10, decimalPlaces));
      });
      if (scale !== 1) {
        pathElement.setAttribute(
          "transform",
          `scale(${(1 / scale).toString().replace(/^0\./, ".")})`
        );
      }

      d = d.replace(/-?\d*\.?\d+/g, match =>
        Math.round((parseFloat(match) * 10 * scale) / 10).toString()
      ); // Round decimals to 1 decimal place

      d = d.replace(/h0(?![\d.])/g, ""); // Remove "h" followed by the number 0, but not if followed by a digit or a decimal
      d = d.replace(/s0 0 0 0(?![\d.])/g, "");
      //d = d.replace(/m[^clshv]*(m)/gim, "$2"); // Remove consecutive "M" commands

      //for dev
      d = d.replace(/([clshvm])/gim, "\n$1"); // Add newline before commands

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
      .replace(/>\s+</g, "><"); // Remove all whitespace between ">" and "<"

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
