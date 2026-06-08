const { optimize } = require("svgo");
const fs = require("fs");

const svg = fs.readFileSync(`${__dirname}/samples/svgo/lightrail.svg`, "utf8");

const result = optimize(svg, {
  multipass: true,
  plugins: [
    "preset-default",
    {
      name: "convertPathData",
      params: { floatPrecision: 0 }
    }
  ]
});

fs.writeFileSync(`${__dirname}/samples/svgo/output/lightrail.svg`, result.data);
