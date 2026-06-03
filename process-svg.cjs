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
 * @property {number} scaleAll - A scaling factor to apply to the SVG dimensions.
 * @property {boolean} noPathsMerge - Whether to merge paths with matching attributes.
 * @property {string} optionsPath - conversion options
 * @property {fileOptions[]} [fileOptions] - individual data for each file
 */

const SVG_NS = "http://www.w3.org/2000/svg";

const { JSDOM } = require("jsdom");
const {
  processPathD,
  getVisibilityProperties
} = require("./process-path-d.cjs");

const {
  removeGroupsWithNoAttributes,
  groupAttributes,
  ConvertCommonElementstoUseElements,
  applyScaleToViewBox
} = require("./process-grouping.cjs");

const ConvertLinesToPaths = true;
const shortenIds = true;
const removeStyles = true;
const styleToAttributes = true;

const { elementHasAttribute } = require("./attributeProperties.cjs");

const globalReplacements = [
  { from: /#ffffff/gim, to: "#fff" },
  { from: /#000000/gim, to: "#000" }
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

  if (fileOptions)
    fileOptions.replacements.forEach(replacement => {
      const pat = replacement.pattern
        ? new RegExp(replacement.pattern, "g")
        : replacement.text;
      if (pat) data = data.replace(pat, replacement.replacement);
    });

  globalReplacements.forEach(replacement => {
    data = data.replace(replacement.from, replacement.to);
  });

  // Parse the transformed data as HTML
  const dom = new JSDOM(data, { contentType: "image/svg+xml" });
  const document = dom.window.document;

  const svgElement = document.querySelector("svg");
  if (!svgElement) {
    console.error(`Missing SVG element`);
    process.exit(1);
  }

  // document level Only remove ids that aren't used in the SVG
  [...document.querySelectorAll("[id]")]
    .filter(element => !svgElement.innerHTML.includes(`#${element.id}`))
    .forEach(element => element.removeAttribute("id"));

  //remove gradients that are not used (no ids)
  svgElement
    .querySelectorAll("linearGradient:not([id]), radialGradient:not([id])")
    .forEach(gradient => gradient.remove());

  // Move all gradients with IDs to the DEF area
  const defsElement =
    svgElement.querySelector("svg > defs") ||
    document.createElementNS(SVG_NS, "defs");
  svgElement
    .querySelectorAll("linearGradient, radialGradient, clipPath")
    .forEach(element => defsElement.appendChild(element));
  if (!defsElement.parentElement && defsElement.childElementCount)
    // Put the defs element at the beginning of the SVG
    svgElement.insertBefore(defsElement, svgElement.firstChild);

  svgElement.querySelectorAll("svg > defs > linearGradient").forEach(gradient =>
    //remove "offest=0" from gradientTransform stops
    gradient
      .querySelectorAll("stop[offset='0']")
      .forEach(stopElement => stopElement.removeAttribute("offset"))
  );

  //find "USE" elements that are used once and not transformed and replace them with the actual content
  [
    .../** @type {NodeListOf<SVGUseElement>} */ (
      svgElement.querySelectorAll("use")
    )
  ]
    .filter(
      useElement =>
        (useElement.getAttribute("x") || "0") === "0" &&
        (useElement.getAttribute("y") || "0") === "0"
    )
    .forEach(useElement => {
      const href =
        useElement.getAttribute("xlink:href") ||
        useElement.getAttribute("href");
      if (!href) return;

      // Remove the DEF Element if Make sure this HREF is only used once.
      if (
        svgElement.querySelectorAll(
          `use[href='${href}'], use[xlink\\:href='${href}']`
        ).length === 1
      ) {
        const defElement = svgElement.querySelector(href);
        if (defElement) {
          const prt = useElement.parentElement;
          if (prt) {
            prt.insertBefore(defElement, useElement);
            useElement.remove();
            defElement.removeAttribute("id");
          }
        }
      }
    }); // End USE loop

  // Version attribute is not needed, and can cause issues with some SVG renderers, so we remove it
  svgElement.removeAttribute("version");

  svgElement.removeAttribute("xml:space");

  if (!svgElement.innerHTML.includes("xlink:"))
    svgElement.removeAttribute("xmlns:xlink");

  svgElement.style.removeProperty("enable-background");

  if (svgElement.getAttribute("style") === "")
    svgElement.removeAttribute("style");

  if (removeStyles) {
    const styletags = svgElement.querySelectorAll("style");
    styletags.forEach(styletag => {
      const styleDOM = new JSDOM(
        `<!DOCTYPE html><html><head>${styletag.outerHTML}</head></html>`
      );

      [...styleDOM.window.document.styleSheets].forEach(styleSheet =>
        /** @type {CSSStyleRule[]} */ ([...styleSheet.cssRules])
          .filter(rule => rule.cssText)
          .forEach(rule =>
            /** @type {NodeListOf<HTMLElement>} */ (
              svgElement.querySelectorAll(rule.selectorText)
            ).forEach(element =>
              element.setAttribute(
                "style",
                element.style.cssText + rule.style.cssText
              )
            )
          )
      );
      styletag.remove();
    });

    // Remove all classes, since the stylesheets have been removed
    svgElement
      .querySelectorAll("[class]")
      .forEach(element => element.removeAttribute("class"));
  } // End styles loop

  if (styleToAttributes)
    // pull out style elements to make attributes
    /** @type {NodeListOf<HTMLElement>} */
    (svgElement.querySelectorAll("[style]")).forEach(element => {
      Array.from(element.style).forEach(attr => {
        const attrValue = element.style.getPropertyValue(attr);

        if (attrValue && elementHasAttribute(element.tagName, attr))
          element.setAttribute(attr, attrValue);
      });

      element.removeAttribute("style");
    });

  // Full Document cleanup loop
  [...document.querySelectorAll("*")].forEach(element => {
    // Remove all HTML comments, document level
    [...element.childNodes]
      .filter(child => child.nodeType === dom.window.Node.COMMENT_NODE)
      .forEach(child => child.remove());

    const attributes = [...element.attributes];

    // Find any attributes that end in "px" and remove the "px", since they are not needed in SVG and just take up space. Only do this for attributes that are actually numbers, to avoid accidentally changing things like "font-family: Arial, Helvetica, sans-serif" which could contain "px" in the font names.
    attributes
      .filter(
        attr =>
          attr.value.endsWith("px") &&
          !isNaN(parseFloat(attr.value.replace("px", "")))
      )
      .forEach(attr =>
        element.setAttribute(attr.name, attr.value.replace("px", ""))
      );

    //Convert RGB colors to hex
    attributes
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
      );

    //select all elements with attributes that start with "data-" and remove them.
    attributes
      .filter(attr => attr.name.startsWith("data-"))
      .forEach(attr => element.removeAttributeNode(attr));
  }); // End full document cleanup loop

  // Remove "isolation" attributes if no mix-blend-mode is used in the SVG, since "isolation" only affects elements with mix-blend-mode
  if (!svgElement.querySelector("[mix-blend-mode]"))
    svgElement
      .querySelectorAll("[isolation]")
      .forEach(element => element.removeAttribute("isolation"));

  // Remove "stroke-miterlimit" attributes if no "stroke-linecap" attribute is set to "miter", since "stroke-miterlimit" only affects elements with "stroke-linecap" set to "miter"
  if (!svgElement.querySelector("[stroke-linecap='miter']"))
    svgElement
      .querySelectorAll("[stroke-miterlimit]")
      .forEach(element => element.removeAttribute("stroke-miterlimit"));

  // re-id everything
  if (shortenIds)
    svgElement
      .querySelectorAll("defs > linearGradient[id]")
      .forEach((element, i) => {
        const newId = `ID${i.toString(16)}`;

        svgElement
          .querySelectorAll(`[fill="url(#${element.id})"]`)
          .forEach(ref => ref.setAttribute("fill", `url(#${newId})`));

        element.id = newId;
      });

  //Convert polygons to paths
  svgElement.querySelectorAll("polygon").forEach(polygonElement => {
    const pathElement = document.createElementNS(SVG_NS, "path");
    const points = (polygonElement.getAttribute("points") || "")
      .replace(/\s/g, " ")
      .trim();
    const pointsArray = points.split(/[\s,]+/);
    const d = pointsArray.reduce(
      (acc, point, index) =>
        index % 2 ? `${acc}${point}` : `${acc}${index ? "L" : "M"}${point} `,
      ""
    );

    pathElement.setAttribute("d", `${d}Z`);
    [...polygonElement.attributes]
      .filter(attr => elementHasAttribute("path", attr.name))
      .forEach(attr => pathElement.setAttribute(attr.name, attr.value));

    polygonElement.parentElement?.insertBefore(pathElement, polygonElement);
    polygonElement.remove();
  });

  //Convert lines to paths
  if (ConvertLinesToPaths) {
    svgElement.querySelectorAll("line").forEach(lineElement => {
      const pathElement = /** @type {SVGPathElement} */ (
        /** @type {unknown} */ (document.createElementNS(SVG_NS, "path"))
      );

      pathElement.setAttribute(
        "d",
        `M${lineElement.getAttribute("x1")} ${lineElement.getAttribute("y1")}L${lineElement.getAttribute("x2")} ${lineElement.getAttribute("y2")}`
      );
      [...lineElement.attributes]
        .filter(attr => elementHasAttribute("path", attr.name))
        .forEach(attr => pathElement.setAttribute(attr.name, attr.value));

      lineElement.parentElement?.insertBefore(pathElement, lineElement);
      lineElement.remove();
    });

    //Convert simple rects to paths
    svgElement.querySelectorAll("rect").forEach(rectElement => {
      const pathElement = /** @type {SVGPathElement} */ (
        /** @type {unknown} */ (document.createElementNS(SVG_NS, "path"))
      );

      if (
        !rectElement.hasAttribute("rx") &&
        !rectElement.hasAttribute("ry") &&
        !rectElement.getAttribute("width")?.includes("%") &&
        !rectElement.getAttribute("height")?.includes("%")
      ) {
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
          `M${rectX} ${rectY}h${rectWidth}v${rectHeight}H${rectX}Z`
        );

        [...rectElement.attributes]
          .filter(attr => elementHasAttribute("path", attr.name))
          .forEach(attr => pathElement.setAttribute(attr.name, attr.value));

        rectElement.parentElement?.insertBefore(pathElement, rectElement);
        rectElement.remove();
      }
    });
  }
  // Look up the parent chain for stroke, fill, or stroke-width atrributes
  svgElement.querySelectorAll("path").forEach(element => {
    const props = getVisibilityProperties(element);
    if (
      props.fill === "none" &&
      (props.stroke === "none" || props.strokeWidth === 0)
    )
      element.remove();
  });

  // Process all path statements
  svgElement
    .querySelectorAll("path")
    .forEach(pathElement =>
      pathElement.setAttribute(
        "d",
        processPathD(pathElement.getAttribute("d") || "", options, pathElement)
      )
    );

  // Round transform attributes to the specified number of decimal places
  svgElement.querySelectorAll("linearGradient").forEach(element => {
    ["x1", "x2", "y1", "y2"].forEach(attr => {
      const value = parseFloat(element.getAttribute(attr) || "0");
      if (!isNaN(value)) element.setAttribute(attr, value.toFixed(0));
    });
  });

  //Convert "translate" transforms into X and Y attributes where possible, to reduce the number of transforms and make the SVG easier to edit
  svgElement
    .querySelectorAll("text[transform^='translate']")
    .forEach(element => {
      const transform = element.getAttribute("transform");
      if (!transform) return;

      const match = transform.match(/translate\(\s*([^)]+)\s*\)/);
      if (!match) return;

      const [x, y] = match[1]
        .split(/[\s,]+/)
        .map(coord => parseFloat(coord) || 0);

      if (x !== 0) element.setAttribute("x", x.toString());
      if (y !== 0) element.setAttribute("y", y.toString());

      const newTransform = transform.replace(match[0], "").trim();
      if (newTransform.length === 0) element.removeAttribute("transform");
      else element.setAttribute("transform", newTransform);
    });

  // Scale CIRCLE and RECT elements to attempt to remove decimal points and apply a scale transform
  [...svgElement.querySelectorAll("circle, rect, text, ellipse")].forEach(
    Element => {
      // Extract numeric attributes
      const attrs = [
        "cx",
        "cy",
        "r",
        "x",
        "y",
        "width",
        "height",
        "rx",
        "ry",
        "font-size"
      ].filter(attr => Element.hasAttribute(attr));
      const values = attrs.map(a => Element.getAttribute(a));

      // Determine max decimal places across attributes
      let scale = options.scaleAll || 1;
      let maxDecimals = 0;
      if (scale === 1) {
        values.forEach(val => {
          if (!val) return;
          const match = val.match(/\.(\d+)/);
          if (match) {
            const decimals = match[1].length;
            if (decimals > maxDecimals) maxDecimals = decimals;
          }
        });

        // If no decimals, no scaling needed
        if (maxDecimals === 0) return;
        scale = Math.pow(10, maxDecimals);
      } else maxDecimals = Math.log10(scale);

      // Apply scaling + rounding
      attrs.forEach(attr => {
        const raw = parseFloat(Element.getAttribute(attr) || "0");
        if (isNaN(raw)) return;
        const scaled = Math.round(raw * scale).toFixed(0);
        Element.setAttribute(attr, scaled);
      });

      // Add or merge transform
      const existing = Element.getAttribute("transform");
      const scaleStr = `scale(${(1 / scale).toFixed(maxDecimals).replace(/^0\./, ".")})`;

      Element.setAttribute(
        "transform",
        existing ? `${existing} ${scaleStr}` : scaleStr
      );

      const props = getVisibilityProperties(Element);
      if (props.stroke !== "none" || Element.hasAttribute("stroke-width")) {
        Element.setAttribute(
          "stroke-width",
          (props.strokeWidth * scale).toString()
        );
      }
    }
  );

  //Remove X and Y attributes with a value of 0, since they don't affect the rendering and just take up space
  document.querySelectorAll("[x='0']").forEach(e => e.removeAttribute("x"));
  document.querySelectorAll("[y='0']").forEach(e => e.removeAttribute("y"));

  //Remove tspan elements with no attributes, since they don't affect the rendering and just take up space
  [...svgElement.querySelectorAll("tspan")]
    .filter(tspan => tspan.attributes.length === 0)
    .forEach(tspan => {
      const parent = tspan.parentElement;
      if (!parent) return;

      // Move all child nodes of the tspan to the parent
      while (tspan.firstChild) parent.insertBefore(tspan.firstChild, tspan);

      tspan.remove();
    });

  //Remove "data-scaled" attributes that may have been added during processing, since they are not needed in the final SVG and just take up space
  svgElement
    .querySelectorAll("[data-scaled]")
    .forEach(e => e.removeAttribute("data-scaled"));

  // // Extract any scale transforms that aren't ".1" into multiple "g" elements.
  //  svgElement.querySelectorAll("[transform='scale(.01)']").forEach(e => {
  //   // add a "g" tag around the element with the scale transform, and reduce the scale transform on the element
  //   const newG = document.createElementNS(SVG_NS, "g");
  //   newG.setAttribute("transform", "scale(.1)");
  //   e.parentElement?.insertBefore(newG, e);
  //   e.setAttribute("transform", "scale(.1)");
  //   newG.appendChild(e);
  // });

  // Grouping phase

  while (
    removeGroupsWithNoAttributes(svgElement) ||
    groupAttributes(svgElement) ||
    applyScaleToViewBox(svgElement)
  ) {
    // Keep extracting common attributes until no more extractions
  }

  while (ConvertCommonElementstoUseElements(svgElement)) {
    // keep converting common elements to use elements until no more conversions
  }

  // Merge paths after grouping, since grouping may cause some paths to have the same attributes
  if (!options.noPathsMerge) {
    const mergeSiblingPaths = () => {
      let didsomething = false;
      [...svgElement.querySelectorAll("path + path")].forEach(currentPath => {
        const prevPath = currentPath.previousElementSibling;
        if (!prevPath) return;
        if (
          // Do both paths have the same attributes? Except for d
          [
            ...new Set(
              [...prevPath.attributes, ...currentPath.attributes].map(
                attr => attr.name
              )
            )
          ]
            .filter(name => name !== "d")
            .every(
              name =>
                currentPath.getAttribute(name) === prevPath.getAttribute(name)
            )
        ) {
          //Make sure the first M command is uppercase when merging
          const nextD = (prevPath.getAttribute("d") || "").replace(
            /^\s*m/,
            "M"
          );

          prevPath.setAttribute(
            "d",
            `${currentPath.getAttribute("d")}\n${nextD}`
          );
          currentPath.remove();
          didsomething = true;
        }
      });

      return didsomething;
    };

    while (mergeSiblingPaths()) {
      // Keep merging sibling paths until no more merges
    }

    // Process all path statements again
    [...svgElement.querySelectorAll("path")].forEach(pathElement =>
      pathElement.setAttribute(
        "d",
        processPathD(pathElement.getAttribute("d") || "", options)
      )
    );
  }

  // Remove empty tags from dom
  [...svgElement.querySelectorAll(":not(:has(*))")]
    .filter(
      element =>
        element.innerHTML.trim().length === 0 &&
        !element.hasAttributes() &&
        (element.tagName.toLowerCase() !== "defs" ||
          element.childElementCount === 0)
    )
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

  // Final cleanup of empty "g" elements, removing transforms may cause this

  while (removeGroupsWithNoAttributes(svgElement)) {
    // console.log("removeUselessGs");
    // Keep removing empty "g" elements until no more removals
  }

  const serializer = new dom.window.XMLSerializer();
  const xml = serializer.serializeToString(dom.window.document.documentElement);

  // Return serialized HTML
  return (
    xml
      .replace(/&#xA;/g, "\n") //restore CRLFs that were converted to XML entities during processing

      //.replace(/\s{2,}/g, " ") // Replace 2 or more whitespace chars with a single space
      .replace(/>\s+</g, "><") // Remove all whitespace between ">" and "<"
      .replace(/><\/(path|line|rect|stop|use)>/g, "/>") // Replace closing tags with self-closing tags
  );
};

module.exports = { processSvg };
