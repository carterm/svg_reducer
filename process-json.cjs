//@ts-check

const { processPathD } = require("./process-path-d.cjs");

/**
 *
 * @param {string} data
 * @param {import("./process-svg.cjs").processDataOptions} options
 * @returns
 */
const processJson = (/** @type {string} */ data, options) => {
  const json = JSON.parse(data);
  [...json.icons].forEach(icon => {
    const joinall = false;

    if (joinall) {
      const d = [...icon.icon.paths].join("");
      const newd = processPathD(d, options);
      icon.icon.paths = [newd];
    } else {
      [...icon.icon.paths].forEach((path, i) => {
        icon.icon.paths[i] = processPathD(path, options);
      });
    }

    //console.log(`${icon.properties.name} saved ${icon.icon.paths.length - newd.length}`);
  });

  return JSON.stringify(json, null, 2);
};

module.exports = { processJson };
