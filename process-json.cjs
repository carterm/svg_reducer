//@ts-check

const {
  processPathD,
  getVisibilityProperties
} = require("./process-path-d.cjs");

/**
 *
 * @param {string} data
 * @param {import("./process-svg.cjs").processDataOptions} options
 * @returns
 */
const processJson = (/** @type {string} */ data, options) => {
  const json = JSON.parse(data);

  return JSON.stringify(json, null, 2);
};

module.exports = { processJson };
