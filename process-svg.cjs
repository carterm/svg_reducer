//@ts-check

/**
 * Processes SVG data by performing various transformations and optimizations.
 * @typedef {object} processDataOptions
 * @property {boolean} devmode - Whether to enable development mode.
 * @property {number} maxDecimalPlaces - The maximum number of decimal places to retain.
 */

const { JSDOM } = require("jsdom");
const {
  processPathD,
  getVisibilityProperties
} = require("./process-path-d.cjs");

const mergePaths = true;

const shareableAttributes = ["stroke", "stroke-width", "fill", "transform"];

/**
 *
 * @param {string} data
 * @param {processDataOptions} options
 * @returns
 */
const processSvg = (/** @type {string} */ data, options) => {
  // Parse the transformed data as HTML
  const dom = new JSDOM(data);
  const document = dom.window.document;

  // Remove all HTML comments
  document.querySelectorAll("*").forEach(node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === dom.window.Node.COMMENT_NODE) {
        child.remove();
      }
    });
  });

  const svgElement = document.querySelector("svg");
  if (!svgElement) {
    console.error(`Missing SVG element`);
    process.exit(1);
  }

  document
    .querySelectorAll("[id]")
    .forEach(element => element.removeAttribute("id"));

  svgElement.removeAttribute("data-name");
  ["x", "y"].forEach(attr => {
    if (["0", "0px"].includes(svgElement.getAttribute(attr) || "")) {
      svgElement.removeAttribute(attr);
    }
  });
  svgElement.removeAttribute("xml:space");
  if(!svgElement.innerHTML.includes("xlink:")) {
    svgElement.removeAttribute("xmlns:xlink");
  }

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
          svgElement.querySelectorAll(rule["selectorText"]).forEach(element => {
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

  // pull out style elements to make attributes
  /** @type {HTMLElement[]} */
  ([...svgElement.querySelectorAll("*")]).forEach(element => {
    Array.from(element.style).forEach(attr => {
      if (element.style[attr]) {
        element.setAttribute(attr, element.style[attr]);
        element.style.removeProperty(attr);
      }
    });

    if (!element.style.length) {
      element.removeAttribute("style");
    }
  });

  //Convert lines to paths
  [...svgElement.querySelectorAll("line")].forEach(lineElement => {
    const pathElement = /** @type {SVGPathElement} */ (
      /** @type {unknown} */ (document.createElement("path"))
    );

    pathElement.setAttribute(
      "d",
      `M${lineElement.getAttribute("x1")} ${lineElement.getAttribute("y1")}L${lineElement.getAttribute("x2")} ${lineElement.getAttribute("y2")}`
    );
    [...lineElement.attributes].forEach(attr => {
      if (shareableAttributes.includes(attr.name)) {
        pathElement.setAttribute(attr.name, attr.value);
      }
    });

    lineElement.parentElement?.insertBefore(pathElement, lineElement);
    lineElement.remove();
  });

  //Convert simple rects to paths
  [...svgElement.querySelectorAll("rect")].forEach(rectElement => {
    const pathElement = /** @type {SVGPathElement} */ (
      /** @type {unknown} */ (document.createElement("path"))
    );

    if (!rectElement.getAttribute("rx") && !rectElement.getAttribute("ry")) {
      // Simple rectangle
      //<rect fill="black" width="149.31" height="83.66" />
      // to...
      //<path fill="black" d="M0 0 H149.31 V83.66 H0 Z" />

      const [rectWidth, rectHeight, rectX, rectY] = [
        "width",
        "height",
        "x",
        "y"
      ].map(attr => {
        const value = parseFloat(rectElement.getAttribute(attr) || "0");
        return isNaN(value) ? 0 : value;
      });

      pathElement.setAttribute(
        "d",
        `M${rectX} ${rectY}H${rectX + rectWidth}V${rectY + rectHeight}H${rectX}Z`
      );

      [...rectElement.attributes].forEach(attr => {
        if (shareableAttributes.includes(attr.name)) {
          pathElement.setAttribute(attr.name, attr.value);
        }
      });

      rectElement.parentElement?.insertBefore(pathElement, rectElement);
      rectElement.remove();
    }
  });

  // Look up the parent chain for stroke, fill, or stroke-width atrributes
  [...svgElement.querySelectorAll("path")].forEach(element => {
    const props = getVisibilityProperties(element);
    if (
      props.fill === "none" &&
      (props.stroke === "none" || props.strokeWidth === 0)
    ) {
      element.remove();
    }
  });

  if (mergePaths) {
    // Merge all path elements with matching attributes (ignore "d" attribute) and first letter in "d" attribute is uppercase
    const pathsToMerge = [...svgElement.querySelectorAll("path")];
    for (let i = 0; i < pathsToMerge.length - 1; i++) {
      const nextPath = pathsToMerge[i + 1];
      const currentPath = pathsToMerge[i];

      if (
        // Do both paths have the same attributes? Except for d
        [
          ...new Set(
            [...nextPath.attributes, ...currentPath.attributes].map(
              attr => attr.name
            )
          )
        ]
          .filter(name => name !== "d")
          .every(
            name =>
              currentPath.getAttribute(name) === nextPath.getAttribute(name)
          )
      ) {
        //Make sure the first M command is uppercase when merging
        const nextD = (nextPath.getAttribute("d") || "").replace(/m/, "M");

        nextPath.setAttribute(
          "d",
          `${currentPath.getAttribute("d")}\n${nextD}`
        );
        currentPath.remove();
      }
    }
  }

  // Process all remaining path statements
  svgElement.querySelectorAll("path").forEach(pathElement => {
    pathElement.setAttribute(
      "d",
      processPathD(pathElement.getAttribute("d") || "", options, pathElement)
    );
  }); //End Path loop

  // Push common attributes to "g" elements
  svgElement.querySelectorAll("*").forEach(targetElement => {
    [...targetElement.attributes]
      .filter(attr => shareableAttributes.includes(attr.name))
      .forEach(attr => {
        // Search for a sibling with the same attribute value
        const matchingSiblings = [];
        let sibling = targetElement.nextElementSibling;

        while (sibling?.getAttribute(attr.name) === attr.value) {
          matchingSiblings.push(sibling);
          sibling = sibling.nextElementSibling;
        }

        if (matchingSiblings.length) {
          const newG = document.createElement("g");
          newG.setAttribute(attr.name, attr.value);
          targetElement.parentElement?.insertBefore(newG, targetElement);

          [targetElement, ...matchingSiblings].forEach(sibling2 => {
            sibling2.removeAttribute(attr.name);

            newG.appendChild(sibling2);
          });
        }
      });
  }); //End push to common attributes

  // Remove empty tags from dom
  [...svgElement.querySelectorAll("*")]
    .filter(
      element => !element.hasAttributes() && !element.innerHTML.trim().length
    )
    .forEach(element => {
      element.remove();
    });

  // Merge nested "g" elements
  let gChangeDone = false;
  while (!gChangeDone) {
    gChangeDone = true;
    document.querySelectorAll("g").forEach(gElement => {
      const parent = gElement.parentElement;
      if (
        // If the parent is a "g" element and has only one child or no attributes
        parent &&
        (parent.childElementCount === 1 || gElement.attributes.length === 0)
      ) {
        // Move the attributes and children of the child "g" element to the parent "g" element
        gChangeDone = false;
        [...gElement.attributes].forEach(attr => {
          parent.setAttribute(attr.name, attr.value);
        });
        while (gElement.firstChild) parent.appendChild(gElement.firstChild);

        gElement.remove();
      }
    });
  }

  // Remove "g" elements with only one child
  document.querySelectorAll("g > *:only-child").forEach(onlychild => {
    const gElement = onlychild.parentElement;
    if (gElement?.parentElement) {
      [...gElement.attributes].forEach(attr => {
        onlychild.setAttribute(attr.name, attr.value);
      });
      gElement.parentElement.insertBefore(onlychild, gElement);
      gElement.remove();
    }
  });

  // put path "d" attributes in the correct order
  document.querySelectorAll("path").forEach(pathElement => {
    const d = pathElement.getAttribute("d");
    if (d) {
      pathElement.removeAttribute("d");
      pathElement.setAttribute("d", d);
    }
  });

  // apply the transform to the SVG viewbox if all children have the same scale transform
  const svgChildren = [...svgElement.children];
  if (
    svgChildren
      .map(x => x.getAttribute("transform"))
      .every((transform, _i, a) => transform === a[0])
  ) {
    // Check if the transform is only a scale transform
    const transform = svgChildren[0].getAttribute("transform");
    if (transform) {
      const scaleMatch = transform.match(/scale\((?<val>[^)]+)\)/);

      // Check if the transform is only a scale transform
      if (
        scaleMatch &&
        transform.replace(scaleMatch[0], "").trim().length === 0
      ) {
        const viewbox = svgElement.getAttribute("viewBox");
        const val = scaleMatch.groups?.val;
        if (val && viewbox) {
          const [x, y, width, height] = viewbox.split(" ").map(parseFloat);

          // Update the viewBox to reflect the new scale
          const scale = parseFloat(val);
          svgElement.setAttribute(
            "viewBox",
            `${x / scale} ${y / scale} ${width / scale} ${height / scale}`
          );

          svgChildren.forEach(child => {
            // Remove the scale transform from the child
            child.removeAttribute("transform");
          });
        }
      }
    }
  }

  // Return serialized HTML
  return (
    svgElement.outerHTML
      // .replace(/\r?\n|\r/g, "") // Remove line breaks

      //.replace(/\s{2,}/g, " ") // Replace 2 or more whitespace chars with a single space
      .replace(/>\s+</g, "><") // Remove all whitespace between ">" and "<"
      .replace(/><\/(path|line|rect)>/g, "/>")
  );
};

module.exports = { processSvg };
