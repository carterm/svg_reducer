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

    // Group <path> elements by class
    const pathElements = Array.from(document.querySelectorAll("path[class]"));
    const classMap = {};

    pathElements.forEach(pathElem => {
      const className = pathElem.getAttribute("class");
      pathElem.removeAttribute("class");
      if (!classMap[className]) {
        classMap[className] = document.createElement("g");
        classMap[className].setAttribute("class", className);
      }
      classMap[className].appendChild(pathElem);
    });

    // Append the new <g> elements to the document
    const svgElement = document.querySelector("svg");
    if (!svgElement) {
      console.error(`Missing SVG element`);
      process.exit(1);
    }

    Object.values(classMap).forEach(gElement => {
      svgElement.appendChild(gElement);
    });

    // Serialize the SVG element

    const htmlOutput = svgElement.outerHTML;

    const transformedData = htmlOutput
      .replace(/\r?\n|\r/g, "") // Remove line breaks
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
