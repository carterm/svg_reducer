//@ts-check
const fs = require("node:fs");
const path = require("node:path");
const chalk = require("chalk");
const yargs = require("yargs");
const { globStream } = require("glob");
const { processSvg } = require("./process-svg.cjs");
const { processJson } = require("./process-json.cjs");

// Configure your command-line options
const argv = yargs
  .option("dev", {
    alias: "d",
    type: "boolean",
    description: "Enable developer mode",
    default: false // Default is `false`
  })
  .option("maxDecimalPlaces", {
    alias: "m",
    type: "number",
    description: "Set the maximum number of decimal places",
    default: 2 // Default value
  })
  .option("input", {
    alias: "i",
    type: "string",
    description: "Input file pattern (glob)",
    demandOption: true,
    requiresArg: true
  })
  .help() // Add the --help flag
  .alias("help", "h").argv; // Shortcut for help

/** @type {import("./process-svg.cjs").processDataOptions} */
const processOptions = {
  devmode: argv["dev"],
  maxDecimalPlaces: argv["maxDecimalPlaces"]
};

// Use glob to find matching files
/** @type {string} */
const inputPattern = argv["input"];

const globOptions = {
  cwd: process.cwd(), // Current working directory
  nodir: true // Match only files, not directories
};

// Create a stream for matching files
const stream = globStream(inputPattern, globOptions);

// Process each file in the stream
stream.on("data", inputFile => {
  const outputFile = path.join(
    path.dirname(inputFile),
    "output",
    path.basename(inputFile)
  );

  // Create the necessary directories if they don't exist
  const outputDir = path.dirname(inputFile);

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

      const htmlOutput = inputFile.endsWith(".json")
        ? processJson(data, processOptions)
        : processSvg(data, processOptions);

      // Write to the output file
      fs.writeFile(outputFile, htmlOutput, "utf8", writeErr => {
        if (writeErr) {
          console.error(`Error writing the output file: ${writeErr.message}`);
          process.exit(1);
        }
        console.log(`${chalk.green(outputFile)}`);
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
});

// Handle errors
stream.on("error", err => {
  console.error(`Error: ${err}`);
});
