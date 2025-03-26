//@ts-check

/**
 * Processes SVG data by performing various transformations and optimizations.
 * @typedef {object} fileOptions
 * @property {string} name
 * @property {{text:string | null,pattern:string | null,replacement:string}[]} replacements
 */

/**
 * Processes SVG data by performing various transformations and optimizations.
 * @typedef {object} processDataOptions
 * @property {boolean} devmode - Whether to enable development mode.
 * @property {number} maxDecimalPlaces - The maximum number of decimal places to retain.
 * @property {boolean} noPathsMerge - Whether to merge paths with matching attributes.
 * @property {string} optionsPath - conversion options
 * @property {fileOptions[]} [fileOptions] - individual data for each file
 */

const { JSDOM } = require("jsdom");
const {
  processPathD,
  getVisibilityProperties
} = require("./process-path-d.cjs");

const ConvertLinesToPaths = true;
const removeStyles = true;
const styleToAttributes = true;
const styleAttributeMap = [
  "fill",
  "opacity",
  "stop-color",
  "stroke",
  "stroke-width",
  "stroke-miterlimit",
  "clip-path"
];

const shareableAttributes = [
  "opacity",
  "stroke",
  "stroke-width",
  "fill",
  "transform"
];

/**
 *
 * @param {string} data
 * @param {processDataOptions} options
 * @param {string} inputFile
 * @returns
 */
const processSvg = (/** @type {string} */ data, options, inputFile) => {
  const fileOptions = options.fileOptions?.find(x =>
    inputFile.includes(x.name)
  );

  if (fileOptions) {
    fileOptions.replacements.forEach(replacement => {
      const pat = replacement.pattern
        ? new RegExp(replacement.pattern, "g")
        : replacement.text;
      if (pat) data = data.replace(pat, replacement.replacement);
    });
  }

  // Parse the transformed data as HTML
  const dom = new JSDOM(data);
  const document = dom.window.document;

  // Remove all HTML comments, document level
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

  // document level Only remove ids that aren't used in the SVG
  document.querySelectorAll("[id]").forEach(element => {
    if (!svgElement.innerHTML.includes(`#${element.id}`)) {
      element.removeAttribute("id");
    }
  });

  //remove gradients that are not used (no ids)
  svgElement
    .querySelectorAll("linearGradient:not([id]), radialGradient:not([id])")
    .forEach(gradient => {
      gradient.remove();
    });

  // Move all gradients with IDs to the DEF area
  const defsElement =
    svgElement.querySelector("svg > defs") || document.createElement("defs");
  svgElement
    .querySelectorAll("linearGradient, radialGradient, clipPath")
    .forEach(element => {
      defsElement.appendChild(element);
    });
  if (!defsElement.parentElement && defsElement.childElementCount) {
    // Put the defs element at the beginning of the SVG
    svgElement.insertBefore(defsElement, svgElement.firstChild);
  }

  svgElement
    .querySelectorAll("svg > defs > linearGradient")
    .forEach(gradient => {
      //remove "offest=0" from gradientTransform stops
      gradient
        .querySelectorAll("stop[offset='0']")
        .forEach(stopElement => stopElement.removeAttribute("offset"));
    });

  //find "USE" elements and replace them with the actual content
  svgElement.querySelectorAll("use").forEach(useElement => {
    const href = useElement.getAttribute("xlink:href");
    if (href) {
      const targetElement = svgElement.querySelector(href);
      if (targetElement) {
        const prt = useElement.parentElement;
        if (prt) {
          prt.insertBefore(targetElement, useElement);
          useElement.remove();
          targetElement.removeAttribute("id");
        }
      }
    }
  }); // End USE loop

  svgElement.removeAttribute("data-name");
  ["x", "y"].forEach(attr => {
    if (["0", "0px"].includes(svgElement.getAttribute(attr) || "")) {
      svgElement.removeAttribute(attr);
    }
  });
  svgElement.removeAttribute("xml:space");
  if (!svgElement.innerHTML.includes("xlink:")) {
    svgElement.removeAttribute("xmlns:xlink");
  }

  svgElement.style.removeProperty("enable-background");

  if (svgElement.getAttribute("style") === "") {
    svgElement.removeAttribute("style");
  }

  if (removeStyles) {
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
  }

  if (styleToAttributes) {
    // pull out style elements to make attributes
    /** @type {HTMLElement[]} */
    ([...svgElement.querySelectorAll("*")]).forEach(element => {
      Array.from(element.style).forEach(attr => {
        if (styleAttributeMap.includes(attr) && element.style[attr]) {
          element.setAttribute(attr, element.style[attr]);
          element.style.removeProperty(attr);
        }

        if (["enable-background"].includes(attr)) {
          element.style.removeProperty(attr);
        }
      });

      if (!element.style.length) {
        element.removeAttribute("style");
      }
    });
  }

  //Convert RGB colors to hex
  [...svgElement.querySelectorAll("*")].forEach(element =>
    [...element.attributes]
      .filter(attr => attr.value.match(/rgb\(/))
      .forEach(attr =>
        element.setAttribute(
          attr.name,
          `#${attr.value
            .replace(/rgb\(/, "")
            .replace(/\)/, "")
            .split(",")
            .map(x => parseInt(x, 10).toString(16).padStart(2, "0"))
            .join("")}`
        )
      )
  );

  //Convert polygons to paths
  [...svgElement.querySelectorAll("polygonx")].forEach(polygonElement => {
    const pathElement = document.createElement("path");
    const points = polygonElement.getAttribute("points") || "";
    const pointsArray = points.split(/[\s,]+/);
    const d = pointsArray.reduce((acc, point, index) => {
      if (index % 2 === 0) {
        return `${acc} ${point},`;
      } else {
        return `${acc}${point} `;
      }
    }, "M");

    pathElement.setAttribute("d", `${d}Z`);

    polygonElement.parentElement?.insertBefore(pathElement, lineElement);
    polygonElement.remove();
  });

  //Convert lines to paths
  if (ConvertLinesToPaths) {
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
  }
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

  if (!options.noPathsMerge) {
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

  const extractCommonAttributesToGs = () => {
    let didSomething = false;
    // extract common attributes to new parent "g" elements
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
            didSomething = true;
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

    return didSomething;
  };

  const mergeSiblingGs = () => {
    // Merge sibling "g" elements with the same attributes
    let didSomething = false;
    svgElement.querySelectorAll("g + g").forEach(gElement => {
      const gElementSibling = gElement.previousElementSibling;
      if (gElementSibling) {
        const gElementAttributes = [...gElement.attributes];
        const gElementSiblingAttributes = [...gElementSibling.attributes];

        const distinctAttributes = [
          ...new Set(
            [...gElementAttributes, ...gElementSiblingAttributes].map(
              attr => attr.name
            )
          )
        ];

        if (
          distinctAttributes.length === gElementAttributes.length &&
          distinctAttributes.length === gElementSiblingAttributes.length &&
          gElementAttributes.every(attr =>
            gElementSiblingAttributes.find(
              attr2 => attr2.name === attr.name && attr2.value === attr.value
            )
          )
        ) {
          // Pull the sibling (from before/above) into the current element
          [...gElement.children].forEach(child => {
            gElementSibling.appendChild(child);
          });

          gElement.remove();

          didSomething = true;
        }
      }
    });
    return didSomething;
  };

  const removeUselessGs = () => {
    let didSomething = false;
    svgElement.querySelectorAll("g").forEach(gElement => {
      if (gElement.attributes.length === 0) {
        didSomething = true;
        //move all child elements to the parent
        [...gElement.children].forEach(child => {
          gElement.parentElement?.insertBefore(child, gElement);
        });
        gElement.remove();
      }
    });
    return didSomething;
  };

  const pushGAttributesDown = () => {
    let didSomething = false;

    // Remove "g" elements with only one child by pushing all their attributes down to their child
    svgElement.querySelectorAll("g > *:only-child").forEach(onlychild => {
      const gElement = onlychild.parentElement;
      if (gElement?.parentElement) {
        [...gElement.attributes].forEach(attr => {
          const childAttr = onlychild.getAttribute(attr.name);
          if (!childAttr || childAttr === attr.value) {
            didSomething = true;
            onlychild.setAttribute(attr.name, attr.value);
            gElement.removeAttribute(attr.name);
          }
        });

        if (gElement.attributes.length === 0) {
          didSomething = true;
          gElement.parentElement.insertBefore(onlychild, gElement);
          gElement.remove();
        }
      }
    });

    return didSomething;
  };

  while (extractCommonAttributesToGs()) {
    //console.log("extractCommonAttributesToGs");
    // Keep extracting common attributes until no more extractions
  }

  while (mergeSiblingGs()) {
    //console.log("mergeSiblingGs");
    // Keep merging sibling "g" elements with the same attributes until no more merges
  }

  while (pushGAttributesDown()) {
    //console.log("pushGAttributesDown");
    // Keep pushing attributes down until no more pushes
  }

  while (extractCommonAttributesToGs()) {
    //console.log("extractCommonAttributesToGs");
    // Keep extracting common attributes until no more extractions
  }

  while (removeUselessGs()) {
    // console.log("removeUselessGs");
    // Keep removing empty "g" elements until no more removals
  }

  // Remove empty tags from dom
  [...svgElement.querySelectorAll(":not(:has(*))")]
    .filter(element => !element.hasAttributes())
    .forEach(element => {
      element.remove();
    });

  // put path "d" attributes in the correct order
  svgElement.querySelectorAll("path").forEach(pathElement => {
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

  // Some cleanup
  svgElement.querySelectorAll("[data-scaled]").forEach(element => {
    element.removeAttribute("data-scaled");
  });
  svgElement.querySelectorAll("[data-no-merge]").forEach(element => {
    element.removeAttribute("data-no-merge");
  });

  // Return serialized HTML
  return (
    svgElement.outerHTML
      // .replace(/\r?\n|\r/g, "") // Remove line breaks

      //.replace(/\s{2,}/g, " ") // Replace 2 or more whitespace chars with a single space
      .replace(/>\s+</g, "><") // Remove all whitespace between ">" and "<"
      .replace(/><\/(path|line|rect|stop|use)>/g, "/>") // Replace closing tags with self-closing tags
  );
};

module.exports = { processSvg };
