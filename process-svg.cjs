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

const SVG_NS = "http://www.w3.org/2000/svg";

const { JSDOM } = require("jsdom");
const {
  processPathD,
  getVisibilityProperties
} = require("./process-path-d.cjs");

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
        const nextD = (nextPath.getAttribute("d") || "").replace(/^\s*m/, "M");

        nextPath.setAttribute(
          "d",
          `${currentPath.getAttribute("d")}\n${nextD}`
        );
        currentPath.remove();
      }
    }
  }

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
  svgElement
    .querySelectorAll("circle, rect, text, ellipse")
    .forEach(Element => {
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
      let maxDecimals = 0;

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

      const scale = Math.pow(10, maxDecimals);

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
    });

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

  // BEGIN grouping phase, where we attempt to group elements together based on shared attributes
  const groupAttributes = () => {
    let didSomething = false;

    const tempGroupAttributes = [
      "font-family",
      "stroke",
      "stroke-width",
      "stroke-linecap",
      "fill",
      "font",
      "font-size",
      "font-weight",
      "transform"
    ];

    // Process each attribute that can be grouped (e.g., fill, stroke, opacity)
    tempGroupAttributes.forEach(attr => {
      const allWithAttribute = [...svgElement.querySelectorAll(`[${attr}]`)];
      const distinctValues = [
        ...new Set([...allWithAttribute].map(el => el.getAttribute(attr) || ""))
      ];

      const attributeIsOverrideable = !["transform", "opacity"].includes(attr);

      distinctValues.forEach(value => {
        const allMatches = allWithAttribute.filter(
          el => el.getAttribute(attr) === value
        );

        if (allMatches.length <= 1) return;

        allMatches.forEach(myElement => {
          const myParent = myElement.parentElement;
          if (!myParent || myElement.getAttribute(attr) !== value) return;

          //const myAncestors = getAncestors(myElement);
          //const ancestorValue = getAncestorAttributeValue(myAncestors, attr);

          const mySiblingMatches = allMatches.filter(
            e => e !== myElement && e.parentElement === myParent
          );

          if (mySiblingMatches.length) {
            // Try to group each sibling match.  Must also consider the other sibling elements between and make sure the grouping doesn't affect them.

            const siblingsBetween = [myElement];
            const matches = [myElement];
            let sibling = myElement.nextElementSibling;
            let directionForward = true;

            while (sibling) {
              const siblingHasAttribute = sibling.hasAttribute(attr);

              if (siblingHasAttribute && sibling.getAttribute(attr) === value) {
                // This is one of our target matches!  Now it is worth making a group.
                matches.push(sibling);
              } else if (!elementHasAttribute(sibling.tagName, attr)) {
                // This attribute is irrelavant to the tag, so it is safe to include in the group
              } else if (attributeIsOverrideable && siblingHasAttribute) {
                // This sibling is specifying an override for the attribute, so it is safe to include in the group
              } else {
                // Not sure if sibling could be affected by the grouping, so we have to stop here and not include it in the group
                //TODO: recursively check if this is a group

                sibling = null;
                break;
              }

              if (directionForward) {
                siblingsBetween.push(sibling);
                sibling = sibling.nextElementSibling;
                if (!sibling) {
                  directionForward = false;
                  sibling = myElement.previousElementSibling;
                }
              } else {
                siblingsBetween.unshift(sibling);
                sibling = sibling.previousElementSibling;
              }
            }

            if (
              (attributeIsOverrideable ||
                myParent.tagName.toLowerCase() !== "svg") &&
              siblingsBetween.length === myParent.childElementCount &&
              (!myParent.hasAttribute(attr) ||
                myParent.getAttribute(attr) === value)
            ) {
              // All siblings are safe to group, which means we can just apply the attribute to the parent and remove it from all the children, without needing to create a new group element.

              didSomething = true;
              myParent.setAttribute(attr, value);
              matches.forEach(match => match.removeAttribute(attr));

              //console.log(
              //  `Applied to parent of ${siblingsBetween.length}/${myParent.childElementCount} elements with [${attr}="${value}"]`
              //);
            } else if (matches.length > 1) {
              // Make a group with the siblings between.

              didSomething = true;
              const newG = document.createElementNS(SVG_NS, "g");
              newG.setAttribute(attr, value);
              myParent.insertBefore(newG, myElement);

              //console.log(
              //  `Grouped ${matches.length}/${siblingsBetween.length}/${myParent.childElementCount} elements into a new <g> element with [${attr}="${value}"]`
              //);

              siblingsBetween.forEach(sibling2 => {
                if (
                  sibling2.hasAttribute(attr) &&
                  sibling2.getAttribute(attr) === value
                )
                  sibling2.removeAttribute(attr);

                newG.appendChild(sibling2);
              });
            }
          }
        }); // End loop through matches with the same attribute value
      }); // End loop through distinct attribute values
    }); // End loop through groupable attributes
    return didSomething;
  };

  const removeGroupsWithNoAttributes = () => {
    let didSomething = false;
    [...svgElement.querySelectorAll("g")]
      .filter(gElement => gElement.attributes.length === 0)
      .forEach(gElement => {
        didSomething = true;
        //move all child elements to the parent
        [...gElement.children].forEach(child =>
          gElement.parentElement?.insertBefore(child, gElement)
        );
        gElement.remove();
      });
    return didSomething;
  };

  const applyScaleToViewBox = () => {
    // if the dom has a single child with a scale transform, apply the scale to the viewBox and remove the transform

    const directChildren = svgElement.querySelectorAll(
      "svg > g,svg > path,svg > rect,svg > circle,svg > ellipse,svg > line,svg > polyline,svg > polygon"
    );
    if (directChildren.length !== 1) return;

    const firstChild = directChildren[0];
    const transform = firstChild.getAttribute("transform");
    if (!transform) return;
    const scaleMatch = transform.match(/scale\((?<val>[^)]+)\)/);
    if (!scaleMatch) return;

    // Check if the transform is only a scale transform
    const viewbox = svgElement.getAttribute("viewBox");
    const val = scaleMatch.groups?.val;
    if (val && viewbox) {
      const [x, y, width, height] = viewbox.split(" ").map(parseFloat);

      // Update the viewBox to reflect the new scale
      const scale = parseFloat(val);
      const divScale = (/** @type {number} */ topPart) =>
        Number((topPart / scale).toFixed(6)).toString(); // prevents 43.4 / 0.1 = 433.99999999999994

      svgElement.setAttribute(
        "viewBox",
        `${divScale(x)} ${divScale(y)} ${divScale(width)} ${divScale(height)}`
      );

      const newTransform = transform.replace(scaleMatch[0], "").trim();
      if (newTransform.length === 0) firstChild.removeAttribute("transform");
      else firstChild.setAttribute("transform", newTransform);

      return true;
    }
  };

  /**
   * support function for ConvertCommonElementstoUseElements
   * @param {SVGPathElement} pathTarget
   * @param {string} id
   */
  const placeUseElement = (pathTarget, id) => {
    const useElement = document.createElementNS(SVG_NS, "use");
    useElement.setAttribute("href", `#${id}`);

    // Extract the new "x" and "y" attributes from the "M" command in the "d" attribute, and set them as attributes on the use element
    const dAttribute = pathTarget.getAttribute("d") || "";
    const mCommandMatch = dAttribute.match(/^\s*M\s*([-\d.]+)[ ,]([-\d.]+)/);
    if (mCommandMatch) {
      const x = mCommandMatch[1];
      const y = mCommandMatch[2];
      useElement.setAttribute("x", x);
      useElement.setAttribute("y", y);
    }

    pathTarget.parentElement?.insertBefore(useElement, pathTarget);
  };

  const ConvertCommonElementstoUseElements = () => {
    // Find elements that are used more than once with the same attributes and convert them to use elements with a single definition in defs.  This can reduce file size by reusing the same element instead of repeating it multiple times.
    // example: if we have multiple path elements with identical paths, after the initial "M" command, we can convert these to USE elements.
    //  <path d="M6952 1136  h-163v109c0 7 6 13 13 13h150c7 0 13-6 13-13v-96c0-7-6-13-13-13z" />
    //  <path d="M6939 1121  h-163v109c0 7 6 13 13 13h150c7 0 13-6 13-13v-96c0-7-6-13-13-13z" />;

    const dAttributeMinLengthForUse = 15; // Only convert to use elements if the "d" attribute is at least this long, to avoid creating use elements for very simple paths that don't benefit much from reuse.

    // compare every path element to every other path element and find ones with matching "d" attributes (ignoring the first "M" command and any whitespace), and matching attributes except for "d", and convert them to use elements
    const pathElements = [...svgElement.querySelectorAll("path")];
    const seen = new Map(); // Map to track seen paths with their attributes (excluding "d")

    let defSection = svgElement.querySelector("defs");

    pathElements.forEach(path => {
      if (path.attributes.length > 1) return; // Only consider paths with no attributes other than "d" for now, to avoid complications with grouping and attribute overrides.  This can be improved in the future by allowing attributes as long as they match, but it would require more complex logic to handle grouping and overrides.

      const d = path.getAttribute("d") || "";

      // Remove the initial "M{x} {y}" command and its coordinates for comparison
      const dForComparison = d.replace(/^\s*M\s*([-\d.]+)[ ,]([-\d.]+)/, "");

      if (dForComparison.length < dAttributeMinLengthForUse) return; // Skip short paths

      const key = `${dForComparison}`;

      // Check if we've seen an identical path before. If this is the first time we see this path, store it in the map. If we've seen it before, replace this path with a use element referencing the first one.  Also move the first one to defs if it isn't already, since use elements need to reference elements in defs.
      if (seen.has(key)) {
        const existing = seen.get(key);
        if (existing) {
          // Make sure we have a defs section to put the reusable element in
          if (!defSection) {
            defSection = document.createElementNS(SVG_NS, "defs");
            svgElement.insertBefore(defSection, svgElement.firstChild);
          }

          // Move the existing element to defs if it's not already there and replace it with a use element
          if (existing.parentElement !== defSection) {
            const id = `use-${defSection.childElementCount}`;
            placeUseElement(existing, id);
            existing.id = id;
            existing.setAttribute("d", `M0 0${key}`);
            defSection.appendChild(existing);
          }
          placeUseElement(path, existing.id);
          path.remove();
        }
      } else {
        seen.set(key, path);
      }
    });

    let didSomething = false;

    return didSomething;
  };

  // Grouping phase

  while (
    removeGroupsWithNoAttributes() ||
    groupAttributes() ||
    applyScaleToViewBox() ||
    ConvertCommonElementstoUseElements()
  ) {
    // Keep extracting common attributes until no more extractions
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

  while (removeGroupsWithNoAttributes()) {
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
