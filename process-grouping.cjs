//@ts-check

const { elementHasAttribute } = require("./attributeProperties.cjs");

const SVG_NS = "http://www.w3.org/2000/svg";

// BEGIN grouping phase, where we attempt to group elements together based on shared attributes
/**
 * @param {SVGSVGElement} svgElement
 */
const groupAttributes = svgElement => {
  const document = svgElement.ownerDocument;
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
    //Check for a global match above this to allow us to remove the attribute.

    const allWithAttribute = [
      ...svgElement.querySelectorAll(`[${attr}]`)
    ].filter(
      el => !el.closest("defs") // ignore anything in defs
    );
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

        // Check up the parent chain to see if the next attribute matches that would make this attribute unecessary on this eleemnt.
        if (myParent.closest(`[${attr}]`)?.getAttribute(attr) === value) {
          // This element is already inheriting the attribute from a parent, so we don't need to group it with its siblings, since we can just remove the attribute from this element and it will still have the same appearance.
          didSomething = true;
          myElement.removeAttribute(attr);
          return;
        }

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

/**
 * @param {SVGSVGElement} svgElement
 */
const removeGroupsWithNoAttributes = svgElement => {
  let didSomething = false;
  [...svgElement.querySelectorAll("g")]
    .filter(
      el => !el.closest("defs") // ignore anything in defs
    )
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

/**
 * @param {SVGSVGElement} svgElement
 */
const applyScaleToViewBox = svgElement => {
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
  const useElement = pathTarget.ownerDocument.createElementNS(SVG_NS, "use");
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

/**
 *
 * @param {Element} sourceElement
 * @param {Element} targetElement
 */
const copyAllAttributes = (sourceElement, targetElement) => {
  [...sourceElement.attributes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(attr => targetElement.setAttribute(attr.name, attr.value));
};

/**
 *
 * @param {Element} element
 * @param {string} attributeName
 * @returns
 */
const getAttributeNumberValue = (element, attributeName) => {
  const value = element.getAttribute(attributeName);
  return value ? parseFloat(value) : 0;
};

/**
 * @param {Element} sourceUse
 * @param {Element | null} element
 * @returns {Element | null}
 */
const convertToRelativeElement = (sourceUse, element) => {
  if (!element) return null;
  const sourceX = getAttributeNumberValue(sourceUse, "x");
  const sourceY = getAttributeNumberValue(sourceUse, "y");

  switch (element.tagName.toLowerCase()) {
    case "circle": {
      const newElement = element.ownerDocument.createElementNS(
        SVG_NS,
        "circle"
      );
      copyAllAttributes(element, newElement);

      const newCx = getAttributeNumberValue(element, "cx") - sourceX;
      const newCy = getAttributeNumberValue(element, "cy") - sourceY;

      if (newCx !== 0) newElement.setAttribute("cx", newCx.toString());
      else newElement.removeAttribute("cx");
      if (newCy !== 0) newElement.setAttribute("cy", newCy.toString());
      else newElement.removeAttribute("cy");

      return newElement;
    }
    case "rect": {
      const newElement = element.ownerDocument.createElementNS(SVG_NS, "rect");
      copyAllAttributes(element, newElement);

      const newX = getAttributeNumberValue(element, "x") - sourceX;
      const newY = getAttributeNumberValue(element, "y") - sourceY;

      if (newX !== 0) newElement.setAttribute("x", newX.toString());
      else newElement.removeAttribute("x");
      if (newY !== 0) newElement.setAttribute("y", newY.toString());
      else newElement.removeAttribute("y");

      return newElement;
    }
    case "path": {
      const newElement = element.ownerDocument.createElementNS(SVG_NS, "path");
      copyAllAttributes(element, newElement);

      // Get the X and Y coordinates from the first "M" command in the "d" attribute, and convert them to relative coordinates based on the sourceUse's "x" and "y" attributes, then update the "d" attribute with the new relative coordinates.  If there is no "M" command, just return the element with copied attributes.
      const dAttribute = element.getAttribute("d") || "";
      const mCommandMatch = dAttribute.match(/^\s*M\s*([-\d.]+)[ ,]?([-\d.]+)/);
      if (!mCommandMatch) return null;

      const mX = parseFloat(mCommandMatch[1]);
      const mY = parseFloat(mCommandMatch[2]);
      const newD = dAttribute.replace(
        /^\s*M\s*([-\d.]+)[ ,]?([-\d.]+)/,
        `M${mX - sourceX} ${mY - sourceY}`.replace(/ -/g, "-")
      );
      newElement.setAttribute("d", newD);

      return newElement;
    }
    default:
      return null;
  }
};

/**
 * @param {Element} element1
 * @param {Element | null} element2
 */
const relativelyCloseElements = (element1, element2) => {
  if (!element2) return false;
  const threshold = 5; // Define a threshold for how close the coordinates need to be to be considered the same

  /** @param {Element} element */
  const getCoordinates = element => {
    switch (element.tagName.toLowerCase()) {
      case "circle":
        return [
          getAttributeNumberValue(element, "cx"),
          getAttributeNumberValue(element, "cy")
        ];
      case "rect":
        return [
          getAttributeNumberValue(element, "x"),
          getAttributeNumberValue(element, "y")
        ];
      case "path": {
        const dAttribute = element.getAttribute("d") || "";
        const mCommandMatch = dAttribute.match(
          /^\s*M\s*([-\d.]+)[ ,]?([-\d.]+)/
        );
        if (!mCommandMatch) return null;
        return [parseFloat(mCommandMatch[1]), parseFloat(mCommandMatch[2])];
      }
      default:
        return null;
    }
  };

  const coords1 = getCoordinates(element1);
  const coords2 = getCoordinates(element2);

  if (!coords1 || !coords2) return false;

  const distance = Math.sqrt(
    Math.pow(coords1[0] - coords2[0], 2) + Math.pow(coords1[1] - coords2[1], 2)
  );

  return distance <= threshold;
};

/**
 * @param {SVGSVGElement} svgElement
 */
const ConvertCommonElementstoUseElements = svgElement => {
  let didSomething = false;
  // Find elements that are used more than once with the same attributes and convert them to use elements with a single definition in defs.  This can reduce file size by reusing the same element instead of repeating it multiple times.
  // example: if we have multiple path elements with identical paths, after the initial "M" command, we can convert these to USE elements.
  //  <path d="M6952 1136  h-163v109c0 7 6 13 13 13h150c7 0 13-6 13-13v-96c0-7-6-13-13-13z" />
  //  <path d="M6939 1121  h-163v109c0 7 6 13 13 13h150c7 0 13-6 13-13v-96c0-7-6-13-13-13z" />;

  const dAttributeMinLengthForUse = 15; // Only convert to use elements if the "d" attribute is at least this long, to avoid creating use elements for very simple paths that don't benefit much from reuse.
  const ignoredAttributesForUse = ["d", "id", "href", "x", "y"]; // Attributes to ignore when comparing elements for reuse, since these will be different for each instance of the element.

  // compare every path element to every other path element and find ones with matching "d" attributes (ignoring the first "M" command and any whitespace), and matching attributes except for "d", and convert them to use elements
  const pathElements = [...svgElement.querySelectorAll("path")].filter(
    path => !path.closest("defs") // ignore anything in defs
  );
  const seen = new Map(); // Map to track seen paths with their attributes (excluding "d")

  let defSection = svgElement.querySelector("defs");

  pathElements.forEach(path => {
    const d = path.getAttribute("d") || "";

    // Remove the initial "M{x} {y}" command and its coordinates for comparison
    const dForComparison = d.replace(/^\s*M\s*([-\d.]+)[ ,]?([-\d.]+)/, "");

    if (dForComparison.length < dAttributeMinLengthForUse) return; // Skip short paths

    const key = `${dForComparison}`;

    // Check if we've seen an identical path before. If this is the first time we see this path, store it in the map. If we've seen it before, replace this path with a use element referencing the first one.  Also move the first one to defs if it isn't already, since use elements need to reference elements in defs.
    if (seen.has(key)) {
      const existing = seen.get(key);
      if (existing) {
        // Check for matching attributes except for "d","id","href","x","y"
        const existingAttributes = [...existing.attributes].filter(
          attr => !ignoredAttributesForUse.includes(attr.name)
        );
        const currentAttributes = [...path.attributes].filter(
          attr => !ignoredAttributesForUse.includes(attr.name)
        );

        const attributesMatch =
          existingAttributes.length === currentAttributes.length &&
          existingAttributes.every(attr => {
            const matchingAttr = currentAttributes.find(
              a => a.name === attr.name && a.value === attr.value
            );
            return !!matchingAttr;
          });

        if (!attributesMatch) return;

        // Make sure we have a defs section to put the reusable element in
        if (!defSection) {
          defSection = svgElement.ownerDocument.createElementNS(SVG_NS, "defs");
          svgElement.insertBefore(defSection, svgElement.firstChild);
        }

        // Move the existing element to defs if it's not already there and replace it with a use element
        if (existing.parentElement !== defSection) {
          const id = `use-${defSection.querySelectorAll("[id^='use-']").length}`;
          placeUseElement(existing, id);
          existing.id = id;
          existing.setAttribute("d", `M0 0${key}`);
          defSection.appendChild(existing);
        }
        placeUseElement(path, existing.id);
        didSomething = true;
        path.remove();
      }
    } else {
      seen.set(key, path);
    }
  });

  // Now look at every USE element and see if there are any siblings that can be pulled in.
  defSection?.querySelectorAll("defs > [id^='use-']").forEach(definition => {
    let definitionGroup = definition;
    const href = `#${definitionGroup.id}`;
    const useElements = [...svgElement.querySelectorAll(`use[href="${href}"]`)];
    if (!useElements.length) return;

    // Run this once on using the "previousElementSibling" function and once using the "nextElementSibling" function.

    [true, false].forEach(usePrevious => {
      /**
       * @param {Element} element
       */
      const siblingFunction = element =>
        usePrevious
          ? element.previousElementSibling
          : element.nextElementSibling;

      const sibling = siblingFunction(useElements[0]);

      if (
        sibling &&
        useElements.every(
          useEl => sibling.tagName == siblingFunction(useEl)?.tagName
        )
      ) {
        // All use elements reference the same type of element, so we can pull them into a group and apply shared attributes to the group.;
        const candidate = convertToRelativeElement(
          useElements[0],
          siblingFunction(useElements[0])
        );

        // Make sure all the use elements will have this same relative element.
        if (
          candidate &&
          useElements.every(useEl =>
            relativelyCloseElements(
              candidate,
              convertToRelativeElement(useEl, siblingFunction(useEl))
            )
          )
        ) {
          // All use elements have the same relative element, so we can add one to the defs and remove the relative element

          // Add the candidate element to the definition.
          // If the definition is not a group, wrap it in a new group and move the id to the group.

          if (definitionGroup.tagName.toLowerCase() !== "g") {
            const newGroup = svgElement.ownerDocument.createElementNS(
              SVG_NS,
              "g"
            );

            newGroup.id = definition.id;
            definition.removeAttribute("id");
            definition.parentElement?.insertBefore(newGroup, definition);
            newGroup.appendChild(definition);
            definitionGroup = newGroup;
          }

          // insert the cadidate element as the first child of the definition group.
          if (usePrevious)
            definitionGroup.insertBefore(candidate, definitionGroup.firstChild);
          else definitionGroup.appendChild(candidate);

          // Remove the relative elements before each use element, since they are now represented in the definition.
          useElements.forEach(useEl => siblingFunction(useEl)?.remove());

          didSomething = true;
        }
      }
    });
  });

  return didSomething;
};

module.exports = {
  groupAttributes,
  removeGroupsWithNoAttributes,
  applyScaleToViewBox,
  ConvertCommonElementstoUseElements
};
