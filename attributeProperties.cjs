//@ts-check
/**
 * @typedef {object} SvgAttributeInfo
 * @property {boolean} overrideable
 *   Whether this attribute can be safely hoisted or collapsed without changing rendering.
 * @property {boolean} inherited
 *   Whether this attribute naturally inherits from parent → child in SVG/CSS.
 * @property {boolean} stacking
 *   Whether multiple instances of this attribute compound (e.g., opacity, transform).
 * @property {string[]} tags
 *   List of SVG tag names that support this attribute.
 *   If empty, the attribute is considered global.
 */

/**
 * @typedef {Record<string, SvgAttributeInfo>} SvgAttributeMap
 *   A dictionary where each key is an attribute name (e.g., "fill", "opacity")
 *   and the value describes how that attribute behaves and where it applies.
 */
/**
 * @type {SvgAttributeMap}
 */
const attributeProperties = {
  "clip-path": {
    overrideable: false,
    inherited: false,
    stacking: true,
    tags: [
      "path",
      "circle",
      "ellipse",
      "rect",
      "line",
      "polyline",
      "polygon",
      "text",
      "image"
    ]
  },

  fill: {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: [
      "path",
      "circle",
      "ellipse",
      "rect",
      "line",
      "polyline",
      "polygon",
      "text",
      "tspan",
      "textPath"
    ]
  },

  "font-family": {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: ["text", "tspan", "textPath"]
  },

  "font-size": {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: ["text", "tspan", "textPath"]
  },

  "font-weight": {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: ["text", "tspan", "textPath"]
  },

  isolation: {
    overrideable: false,
    inherited: false,
    stacking: true,
    tags: []
  },

  opacity: {
    overrideable: false,
    inherited: false,
    stacking: true,
    tags: [
      "path",
      "circle",
      "ellipse",
      "rect",
      "line",
      "polyline",
      "polygon",
      "text",
      "tspan",
      "textPath",
      "image"
    ]
  },

  "stop-color": {
    overrideable: true,
    inherited: false,
    stacking: false,
    tags: ["stop"]
  },

  stroke: {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: [
      "path",
      "circle",
      "ellipse",
      "rect",
      "line",
      "polyline",
      "polygon",
      "text"
    ]
  },

  "stroke-linecap": {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: ["path", "line", "polyline", "polygon"]
  },

  "stroke-miterlimit": {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: ["path", "polyline", "polygon"]
  },

  "stroke-width": {
    overrideable: true,
    inherited: true,
    stacking: false,
    tags: [
      "path",
      "circle",
      "ellipse",
      "rect",
      "line",
      "polyline",
      "polygon",
      "text"
    ]
  },

  transform: {
    overrideable: false,
    inherited: false,
    stacking: true,
    tags: [
      "path",
      "circle",
      "ellipse",
      "rect",
      "line",
      "polyline",
      "polygon",
      "text",
      "tspan",
      "textPath"
    ]
  }
};

/**
 *
 * @param {string} element
 * @param {string} attribute
 */
const elementHasAttribute = (element, attribute) =>
  ["g", "use"].includes(element.toLowerCase()) ||
  attributeProperties[attribute]?.tags.includes(element.toLowerCase());

/**
 *
 * @param {string} attribute
 */
const attributeIsOverrideable = attribute =>
  attributeProperties[attribute].overrideable;

const groupAbleAttributes = Object.keys(attributeProperties).filter(attr =>
  Object.keys(attributeProperties[attr])
);

module.exports = {
  attributeProperties,
  elementHasAttribute,
  attributeIsOverrideable,
  groupAbleAttributes
};
