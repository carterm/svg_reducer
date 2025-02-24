//@ts-check
const fs = require("node:fs");
const path = require("node:path");

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

    // Remove line breaks
    const transformedData = data.replace(/\r?\n|\r/g, "");

    // Write to the output file
    fs.writeFile(outputFile, transformedData, "utf8", writeErr => {
      if (writeErr) {
        console.error(`Error writing the output file: ${writeErr.message}`);
        process.exit(1);
      }

      console.log(`Successfully transformed and saved to ${outputFile}`);
      console.log(`Original file size: ${data.length.toLocaleString()} bytes`);
      console.log(`Transformed file size: ${transformedData.length.toLocaleString()} bytes`);
      const reductionPercent = ((data.length - transformedData.length) / data.length) * 100;
      console.log(`Reduction: ${reductionPercent.toFixed(2)}%`);
    });
  });
});
