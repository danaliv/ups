/**
 * Central latitude of the plotting sheet. Parsed from ctrLat, an input tag, in
 * updateCenterLatitude().
 */
var _ctrLat;
/**
 * Central longitude of the plotting sheet. Parsed from ctrLon, an input tag, in
 * updateCenterLongitude().
 */
var _ctrLon;
/**
 * Device-independent pixels per degree of latitude. Computed in setCanvasDimensions().
 */
var _latScale;
/**
 * Device-independent pixels per degree of longitude. Computed in setCanvasDimensions().
 */
var _lonScale;
/**
 * 2D graphics context for drawing on the sheet canvas. Assigned in window.onload.
 */
var _ctx;
/**
 * Sheet dimensions in device-independent pixels. Computed in setCanvasDimensions().
 */
var _sheetSize;
/**
 * Lines of position (LOPs) on the sheet. Each element in this array is an object with the
 * following properties, all of which are numbers:
 * {
 *      a: Distance, in nautical miles, from the assumed position to the LOP. "Toward" values are
 *         positive, "away" values are negative.
 *     Zn: Azimuth, in radians, from the assumed position to the celestial body.
 *   aLat: Assumed latitude in degrees. Positive values are north.
 *   aLon: Assumed longitude in degrees. Positive values are east.
 * }
 */
var _lops = [];
/**
 * Intersections between LOPs. These are recomputed whenever the sheet is redrawn. Each element is
 * an object with four properties. Two of the properties, x and y, describe the on-screen
 * coordinates of an intersection relative to the center of the canvas. The other two properties,
 * lat and lon, are the latitude and longitude of the intersection.
 */
var _intersections = [];
/**
 * The LOP currently being constructed by the user. Filled in as each input tag is changed.
 */
var _draftLOP = {};

/**
 * Convert degrees to radians.
 */
function radians(deg) {
  return deg / 180 * Math.PI;
}

/**
 * Project a rhumb line out from a given point at a given azimuth and distance, and return the
 * resulting coordinates. Azimuth is in radians and distance is in nautical miles.
 */
function rhumbPoint(lat, lon, Zn, a) {
  // express a in terms of minutes of longitude
  let aInLon = a / Math.cos(radians(lat));

  return {
    lat: lat + Math.cos(Zn)*a/60,
    lon: lon + Math.sin(Zn)*aInLon/60
  };
}

/**
 * Project a point in lat/lon to canvas coordinates.
 */
function project(lat, lon) {
  return {
    x: _sheetSize.width/2 + (lon - _ctrLon) * _lonScale,
    y: _sheetSize.height/2 + (_ctrLat - lat) * _latScale
  };
}

/**
 * Implements parseIntegerLatitude, parseIntegerLongitude, and parseLongitude. Accepts the
 * following formats:
 *
 * - D°N
 * - DN
 * - +D°
 * - +D
 * - D° (assumed positive/north/east)
 * - D (assumed positive/north/east)
 * - The empty string, which is parsed as the equator/prime meridian
 *
 * When withMinutes is true, the formats are as follows:
 *
 * - D°M'N
 * - D M N
 * - +D° M'
 * - +D M
 * - D°M' (assumed positive/north/east)
 * - D M (assumed positive/north/east)
 *
 * Minutes can include tenths.
 *
 * Arbitrary whitespace is allowed as follows:
 *
 * - Leading and trailing whitespace
 * - Whitespace surrounding °
 * - Whitespace between digits and other tokens
 *
 * Leading zeroes are optional, but the total number of digits in the degrees can't exceed
 * maxDigits.
 */
function parseDegreesDirection(s, maxDigits, maxMagnitude, posDirection, negDirection, withMinutes) {
  s = s.trim().toUpperCase();
  if (s == "") return 0;

  let minutesRegex;
  if (withMinutes) {
    minutesRegex = " *"           // optional whitespace
                 + "("            // m[3], m[8]
                 +   "\\d{1,2}"     // whole minutes
                 +   "(\\.\\d)?"   // m[4], m[9]: optional fractional minutes
                 + ")"
                 + " *"           // optional whitespace
                 + "['‘’]?";      // optional '
  } else {
    minutesRegex = "(())";        // empty capture groups to ensure consistent numbering
  }

  let m = s.match("^"
                 +  "("                                   // DD°N format
                 +    "(\\d{1,"+maxDigits+"})"              // m[2]: degrees
                 +    " *"                                  // optional whitespace
                 +    "[°*]?"                               // optional ° or *
                 +    minutesRegex
                 +    " *"                                  // optional whitespace
                 +    "(["+posDirection+negDirection+"])"   // m[5]: direction
                 +  "|"                                   // +DD° format
                 +    "([-+]?)"                             // m[6]: optional sign (assumed +/N)
                 +    " *"                                  // optional whitespace
                 +    "(\\d{1,"+maxDigits+"})"              // m[7]: degrees
                 +    " *"                                  // optional whitespace
                 +    "[°*]?"                               // optional ° or *
                 +    minutesRegex
                 +  ")"
                 +"$");

  if (!m) return null;

  let minutes, isPositive;

  if (m[2] !== undefined) {
    var magnitude = Number(m[2]);
    minutes = withMinutes ? Number(m[3]) : 0;
    isPositive = (m[5] == posDirection);
  } else if (m[6] !== undefined) {
    var magnitude = Number(m[7]);
    minutes = withMinutes ? Number(m[8]) : 0;
    isPositive = (m[6] != "-");
  } else {
    // shouldn't be possible to get here, but just in case...
    console.warn("BUG: Took supposedly impossible branch in parseDegreesDirection");
    return null;
  }

  magnitude += minutes / 60;

  if (magnitude > maxMagnitude) return null;

  return isPositive ? magnitude : -magnitude;
}

/**
 * Parse a string containing an integer latitude (no minutes) and return a floating-point number,
 * or null if the string can't be parsed. North latitudes are positive. See parseDegreesDirection
 * for details on which formats are accepted.
 */
function parseIntegerLatitude(s) {
  return parseDegreesDirection(s, 2, 89, "N", "S", false);
}

/**
 * Parse a string containing an integer longitude (no minutes) and return a floating-point number,
 * or null if the string can't be parsed. East longitudes are positive. See parseDegreesDirection
 * for details on which formats are accepted.
 */
function parseIntegerLongitude(s) {
  return parseDegreesDirection(s, 3, 180, "E", "W", false);
}

/**
 * Parse a string containing a longitude with minutes and return a floating-point number, or null
 * if the string can't be parsed. East longitudes are positive. See parseDegreesDirection for
 * details on which formats are accepted.
 */
function parseLongitude(s) {
  return parseDegreesDirection(s, 3, 180, "E", "W", true);
}

/**
 * Implements the formatLatitude and formatLongitude functions.
 */
function formatDegreesMinutesDirection(deg, minDegreeDigits, posDirection, negDirection) {
  let absDeg = Math.abs(deg);
  let truncAbsDeg = Math.trunc(absDeg);

  return truncAbsDeg.toLocaleString(undefined, { maximumFractionDigits: 0,
                                                 minimumIntegerDigits: minDegreeDigits })
    + '° '
    + ((absDeg - truncAbsDeg) * 60).toLocaleString(undefined, { minimumFractionDigits: 1,
                                                                maximumFractionDigits: 1,
                                                                minimumIntegerDigits: 2 })
    + '’'
    + (deg > 0 ? " "+posDirection : (deg < 0 ? " "+negDirection : ""));
}

/**
 * Implements the formatIntegerLatitude and formatIntegerLongitude functions.
 */
function formatDegreesDirection(deg, minDigits, posDirection, negDirection) {
  return Math.abs(deg).toLocaleString(undefined, { maximumFractionDigits: 0,
                                                   minimumIntegerDigits: minDigits })
    + '°'
    + (deg > 0 ? " "+posDirection : (deg < 0 ? " "+negDirection : ""));
}

/**
 * Given a latitude as a floating-point number, return a string representation with the format
 * "DD° MM.M’ N".
 */
function formatLatitude(deg) {
  return formatDegreesMinutesDirection(deg, 2, "N", "S");
}

/**
 * Given a latitude as a number, return a string representation with the format "DD° N".
 */
function formatIntegerLatitude(deg) {
  return formatDegreesDirection(deg, 2, "N", "S");
}

/**
 * Given a longitude as a floating-point number, return a string representation with the format
 * "DDD° MM.M’ E".
 */
function formatLongitude(deg) {
  return formatDegreesMinutesDirection(deg, 3, "E", "W");
}

/**
 * Given a longitude as a number, return a string representation with the format "DDD° E".
 */
function formatIntegerLongitude(deg) {
  return formatDegreesDirection(deg, 3, "E", "W");
}

/**
 * Remove the red border around an input.
 */
function clearInputError(elem) {
  elem.style.border = "";
}

/**
 * Add a red border around an input to indicate that the value is erroneous.
 */
function flagInputError(elem) {
  elem.style.border = "3px solid red";
}

/**
 * onchange handler for the center latitude input. Parse the new latitude, change the input value
 * to a normalized format, and redraw the sheet.
 */
function updateCenterLatitude() {
  let newCtrLat = parseIntegerLatitude(ctrLat.value);

  if (newCtrLat === null) {
    flagInputError(ctrLat);
    return;
  }

  ctrLat.value = formatIntegerLatitude(newCtrLat);

  _ctrLat = newCtrLat;
  redraw();
}

/**
 * onchange handler for the center longitude input. Parse the new longitude, change the input value
 * to a normalized format, and redraw the sheet.
 */
function updateCenterLongitude() {
  let newCtrLon = parseIntegerLongitude(ctrLon.value);

  if (newCtrLon === null) {
    flagInputError(ctrLon);
    return;
  }

  ctrLon.value = formatIntegerLongitude(newCtrLon);

  _ctrLon = newCtrLon;
  redraw();
}

/**
 * onchange handler for the a-value input. Parse the new a-value and update the draft LOP.
 */
function updateA() {
  // parse value
  let s = a.value.trim();

  if (s == "") {
    _draftLOP.a = 0;
    return;
  }

  let m = s.match(/^(\d+(\.\d+)?) *['‘’]?$/);

  if (!m) {
    flagInputError(a);
    _draftLOP.a = undefined;
    return;
  }

  let _a = Number(m[1]);

  // normalize input format
  a.value = _a.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    + "’";

  // set sign and store
  _draftLOP.a = (aDir.value == "T" ? _a : -_a);
}

/**
 * onchange handler for the Zn input. Parse the new azimuth and update the draft LOP.
 */
function updateZn() {
  // parse value
  let s = Zn.value.trim();

  if (s == "") {
    _draftLOP.Zn = 0;
    return;
  }

  let m = s.match(/^(\d{1,3}) *°?$/);

  if (!m) {
    flagInputError(Zn);
    _draftLOP.Zn = undefined;
    return;
  }

  let _Zn = Number(m[1]);

  if (_Zn > 360) {
    flagInputError(Zn);
    _draftLOP.Zn = undefined;
    return;
  }

  // normalize input format
  Zn.value = _Zn.toLocaleString(undefined, { minimumIntegerDigits: 3, maximumFractionDigits: 0})
    + "°";

  // convert to radians and store
  _draftLOP.Zn = radians(_Zn);
}

/**
 * onchange handler for the a-Lat input. Parse the new assumed latitude and update the draft LOP.
 */
function updateALat() {
  // parse value
  _draftLOP.aLat = parseIntegerLatitude(aLat.value);

  if (_draftLOP.aLat === null) {
    flagInputError(aLat);
    _draftLOP.aLat = undefined;
    return;
  }

  // normalize input format
  aLat.value = formatIntegerLatitude(_draftLOP.aLat);
}

/**
 * onchange handler for the a-Lon input. Parse the new assumed longitude and update the draft LOP.
 */
function updateALon() {
  // parse value
  _draftLOP.aLon = parseIntegerLongitude(aLon.value);
  if (_draftLOP.aLon == null) {
    _draftLOP.aLon = parseLongitude(aLon.value);
  }

  if (_draftLOP.aLon === null) {
    flagInputError(aLon);
    _draftLOP.aLon = undefined;
    return;
  }

  // normalize input format
  aLon.value = formatLongitude(_draftLOP.aLon);
}

/**
 * Enable or disable the "Add LOP" button depending on whether there is a good draft LOP.
 */
function updateAddLOPButton() {
  addLOPBtn.disabled = _draftLOP.a === null
                    || _draftLOP.a === undefined
                    || _draftLOP.Zn === null
                    || _draftLOP.Zn === undefined
                    || _draftLOP.aLat === null
                    || _draftLOP.aLat === undefined
                    || _draftLOP.aLon === null
                    || _draftLOP.aLon === undefined;
}

/**
 * Add the draft LOP to the sheet and redraw.
 */
function addLOP() {
  addLOPBtn.disabled = true;

  let lop = {};
  Object.assign(lop, _draftLOP);

  _lops.push(lop);

  redraw();
}

/**
 * onmousemove event handler for the canvas. Updates the coordinate display in the footer to show
 * the location under the mouse.
 */
function updateCoordsDisplay(event) {
  // adjust x and y coordinates to be relative to sheet center
  var x = event.x - sheet.offsetLeft - _sheetSize.width/2;
  var y = event.y - sheet.offsetTop - _sheetSize.height/2;

  // snap to an intersection if the mouse is near one
  var minDistanceSqrd = 100; // 10 pixels
  var snappedTo = null;

  _intersections.forEach(function(intersection){
    let dSqrd = Math.pow(x - intersection.x, 2) + Math.pow(y - intersection.y, 2);
    if (dSqrd > minDistanceSqrd) return;

    snappedTo = intersection;
  });

  if (snappedTo !== null) {
    x = snappedTo.x;
    y = snappedTo.y;
    coords.classList.add("snapped");
  } else {
    coords.classList.remove("snapped");
  }

  // find decimal lat and lon
  let lat = -y / _latScale + _ctrLat;
  let lon = x / _lonScale + _ctrLon;

  // display
  coords.innerText = formatLatitude(lat);
  coords.innerHTML += "&nbsp;&nbsp;";
  coords.innerText += formatLongitude(lon);
}

/**
 * onmouseexit event handler for the canvas. Clears the coordinate display in the footer.
 */
function clearCoordsDisplay() {
  coords.innerText = "";
}

/**
 * Resize the sheet canvas so that it occupies the full width of the viewport and the full height
 * remaining after accounting for the header and footer. Then, set the canvas context scale to the
 * device's pixel ratio. If there is no pixel ratio, it is assumed to be 1. Stores the scaled
 * width and height in _sheetSize, and the latitude/longitude scales in _latScale and _lonScale.
 */
function setCanvasDimensions() {
  let pxRatio = window.devicePixelRatio ? window.devicePixelRatio : 1;

  let pxWidth = window.innerWidth;
  let pxHeight = window.innerHeight - header.clientHeight - footer.clientHeight;

  sheet.width = pxWidth * pxRatio;
  sheet.height = pxHeight * pxRatio;
  sheet.style.width = pxWidth + 'px';
  sheet.style.height = pxHeight + 'px';

  _ctx.scale(pxRatio, pxRatio);

  _sheetSize = { width: pxWidth, height: pxHeight };

  _latScale = (_sheetSize.height - 80) / 4;
  _lonScale = _latScale * Math.cos(radians(_ctrLat));
}

/**
 * Resize the canvas to fill the available space, then redraw the lat/lon grid and LOPs.
 */
function redraw() {
  setCanvasDimensions()

  // clear
  _ctx.fillStyle = 'black';
  _ctx.fillRect(0, 0, _sheetSize.width, _sheetSize.height);

  // set up for lat/lon grid
  _ctx.strokeStyle = '#444';
  _ctx.fillStyle = '#333';
  _ctx.font = '200 24px Lato, sans-serif';

  // lat lines
  let ctrY = _sheetSize.height / 2;

  [-2, -1, 0, 1, 2].forEach(function(i){
    _ctx.beginPath();
    _ctx.moveTo(0, ctrY - i*_latScale);
    _ctx.lineTo(_sheetSize.width, ctrY - i*_latScale);
    _ctx.stroke();
  });

  // lon lines and labels
  let ctrX = _sheetSize.width / 2;

  let n = Math.ceil(_sheetSize.width / _lonScale / 2);
  for (var i = -n; i <= n; i++) {
    _ctx.beginPath();
    _ctx.moveTo(ctrX + i*_lonScale, 0);
    _ctx.lineTo(ctrX + i*_lonScale, _sheetSize.height);
    _ctx.stroke();

    if (_lonScale < 111 && i % 2) continue;

    let label = formatIntegerLongitude(_ctrLon + i).replaceAll(" ", "");
    _ctx.fillText(label, ctrX + i*_lonScale + 3, _sheetSize.height - 3);
  }

  // lat labels
  _ctx.strokeStyle = 'black';
  _ctx.lineWidth = 3;

  [-2, -1, 0, 1, 2].forEach(function(i){
    let label = formatIntegerLatitude(_ctrLat + i).replaceAll(" ", "");
    _ctx.strokeText(label, 1, ctrY - i*_latScale - 3);
    _ctx.fillText(label, 1, ctrY - i*_latScale - 3);
  });

  // compute onscreen LOP coordinates
  let screenLOPs = _lops.map(function(lop){
    let _a = lop.a/60 * _latScale;

    let pt = project(lop.aLat, lop.aLon);
    var result = { x00: pt.x, y00: pt.y };

    result.x01 = result.x00 + Math.sin(lop.Zn) * _a;
    result.y01 = result.y00 - Math.cos(lop.Zn) * _a;

    result.x10 = result.x01 + Math.sin(lop.Zn - Math.PI/2) * _sheetSize.width;
    result.y10 = result.y01 - Math.cos(lop.Zn - Math.PI/2) * _sheetSize.width;
    result.x11 = result.x01 - Math.sin(lop.Zn - Math.PI/2) * _sheetSize.width;
    result.y11 = result.y01 + Math.cos(lop.Zn - Math.PI/2) * _sheetSize.width;

    return result;
  });

  // draw LOP knockouts
  _ctx.strokeStyle = 'black';
  _ctx.lineWidth = 5;
  _ctx.beginPath();

  screenLOPs.forEach(function(slop){
    _ctx.moveTo(slop.x00, slop.y00);
    _ctx.lineTo(slop.x01, slop.y01);
    _ctx.moveTo(slop.x10, slop.y10);
    _ctx.lineTo(slop.x11, slop.y11);
  });

  _ctx.stroke();

  // draw LOPs
  _ctx.lineWidth = 1;

  screenLOPs.forEach(function(slop){
    _ctx.strokeStyle = '#3a736e';
    _ctx.beginPath();
    _ctx.moveTo(slop.x00, slop.y00);
    _ctx.lineTo(slop.x01, slop.y01);
    _ctx.stroke();

    _ctx.strokeStyle = '#7BCCC4';
    _ctx.beginPath();
    _ctx.moveTo(slop.x10, slop.y10);
    _ctx.lineTo(slop.x11, slop.y11);
    _ctx.stroke();
  });

  // recompute intersections and draw markers
  _intersections = [];

  _ctx.strokeStyle = 'white';
  _ctx.lineWidth = 1;

  let coeffs = _lops.map(function(lop){
    let a = rhumbPoint(lop.aLat, lop.aLon, lop.Zn + 2*Math.PI/6, 2*lop.a);
    let b = rhumbPoint(lop.aLat, lop.aLon, lop.Zn - 2*Math.PI/6, 2*lop.a);

    let result = {};
    result.m = (b.lat - a.lat) / (b.lon - a.lon);
    result.b = a.lat - result.m * a.lon;

    return result;
  });

  for (var i = 0; i < _lops.length; i++) {
    for (var j = i+1; j < _lops.length; j++) {
      let lonIntercept = (coeffs[j].b - coeffs[i].b) / (coeffs[i].m - coeffs[j].m);
      if (isNaN(lonIntercept)) continue;

      let latIntercept = coeffs[i].m * lonIntercept + coeffs[i].b;
      if (isNaN(latIntercept)) continue;

      let pt = project(latIntercept, lonIntercept);

      if (pt.x < 0 || pt.y < 0 || pt.x > _sheetSize.width || pt.y > _sheetSize.height)
        continue;

      _ctx.beginPath();
      _ctx.arc(pt.x, pt.y, 10, 0, 2*Math.PI);
      _ctx.stroke();

      pt.x -= _sheetSize.width/2;
      pt.y -= _sheetSize.height/2;

      _intersections.push({
        x: pt.x,
        y: pt.y,
        lat: latIntercept,
        lon: lonIntercept
      });
    }
  }
}

/**
 * Set up the app. The footer height is fixed so that it won't shrink when no coordinates are
 * displayed. Then event handlers are installed. Finally, the plotting sheet is drawn.
 */
window.onload = function(){
  footer.style.height = getComputedStyle(footer).height;
  clearCoordsDisplay();

  ctrLat.onchange = updateCenterLatitude;
  ctrLat.onkeydown = function(){ clearInputError(ctrLat) };

  ctrLon.onchange = updateCenterLongitude;
  ctrLon.onkeydown = function(){ clearInputError(ctrLat) };

  a.onchange = function(){ updateA(); updateAddLOPButton(); }
  a.onkeydown = function(){ clearInputError(a) };
  aDir.onchange = function(){ updateA(); updateAddLOPButton(); };
  Zn.onchange = function(){ updateZn(); updateAddLOPButton(); };
  Zn.onkeydown = function(){ clearInputError(Zn) };
  aLat.onchange = function(){ updateALat(); updateAddLOPButton(); };
  aLat.onkeydown = function(){ clearInputError(aLat) };
  aLon.onchange = function(){ updateALon(); updateAddLOPButton(); };;
  aLon.onkeydown = function(){ clearInputError(aLon) };
  addLOPBtn.onclick = addLOP;

  sheet.onmousemove = updateCoordsDisplay;
  sheet.onmouseleave = clearCoordsDisplay;

  window.onresize = redraw;

  updateA();
  updateZn();
  updateALat();
  updateALon();
  updateAddLOPButton();

  _ctx = sheet.getContext('2d');
  updateCenterLatitude();
  updateCenterLongitude();
  redraw();
};
