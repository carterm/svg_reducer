const { optimize } = require("svgo");
const fs = require("fs");

const svg = fs.readFileSync(`${__dirname}/samples/svgo/lightrail.svg`, "utf8");

const result = optimize(svg, {
  multipass: true,
  floatPrecision: 0,
  plugins: [
    "preset-default",

    {
      name: "removeHiddenElems",
      active: true
    },
    {
      name: "removeEmptyContainers",
      active: true
    },
    {
      name: "removeEmptyText",
      active: true
    },
    {
      name: "removeUselessDefs",
      active: true
    },

    {
      name: "cleanupNumericValues",
      params: { floatPrecision: 0 }
    },

    {
      name: "convertPathData",
      params: {
        floatPrecision: 0,
        transformPrecision: 0,
        straightCurves: true,
        curveSmoothShorthands: true
      }
    },

    {
      name: "convertShapeToPath",
      active: true
    },
    {
      name: "mergePaths",
      active: true
    },
    {
      name: "collapseGroups",
      active: true
    },

    /* Accessibility preserved */
    {
      name: "removeTitle",
      active: false
    },
    {
      name: "removeDesc",
      active: false
    },
    {
      name: "removeUnknownsAndDefaults",
      active: false
    },
    {
      name: "removeNonInheritableGroupAttrs",
      active: false
    }
  ]
});

fs.writeFileSync(`${__dirname}/samples/svgo/output/lightrail.svg`, result.data);
