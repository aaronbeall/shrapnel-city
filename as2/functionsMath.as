// MATH FUNCTIONS

_global.RADIANS = Math.PI / 180;
_global.DEGREES = 180 / Math.PI;

// distance between two points
_global.getDistance = function(p1,p2){
	return Math.sqrt(((p1._x - p2._x) * (p1._x - p2._x)) + ((p1._y - p2._y) * (p1._y - p2._y)));
}

// distance square between two points (for faster comparisons)
_global.getDistanceSquare = function(p1,p2){
	return (p1._x - p2._x) * (p1._x - p2._x) + (p1._y - p2._y) * (p1._y - p2._y);
}

// angle from two points
_global.getAngle = function(p1,p2){
	return -Math.atan2((p1._x - p2._x), (p1._y - p2._y)) * DEGREES;
	//return Math.atan2(p2._y - p1._y, p2._x - p1._x) * DEGREES;
}

// vector from length and angle
_global.getVector = function(length, angle){
	var radians = angle * RADIANS;
	return {
		x:length * Math.sin(radians), // 0 degrees = up
		y:-length * Math.cos(radians)
		//x:length * Math.cos(radians), // 0 degrees = right
		//y:length * Math.cos(radians)
	}
}

// find the length of a vector
_global.getLength = function(v){
	return Math.sqrt(v.x * v.x + v.y * v.y);
}

// vector reflection
_global.reflectVector = function(v,n){
	// R = V - 2 * (V · N) * N
	var d = dot(v, n);
	return {
		x:v.x -2 * d * n.x,
		y:v.y -2 * d * n.y 
	}
	function dot(v1,v2){
		return (v1.x * v2.x) + (v1.y * v2.y);
	}
}


// vector normalization
_global.normalizeVector = function(vector){
	var len = getLength(vector);
	return {
		x:vector.x / len,
		y:vector.y / len
	};
}

// make vector perpindicular
_global.perpendicularVector = function(v){
	return {x:v.y, y:-v.x};
}

// difference in degrees between two angles
_global.angleDif = function(a1, a2){
	return Math.abs(wrap(a1 + 180 - a2) - 180);
	function wrap(val){
		while(val < 0) val += 360;
		while(val > 360) val -= 360;
		return val;
	}
}

// angle between two angles
_global.midAngle = function(ang1, ang2){
	ang1 = ang1 % 360;
	ang2 = ang2 % 360;
	var mean = (ang1 + ang2) / 2;
	if (Math.abs(mean - ang1) > 90 || Math.abs(mean - ang2) > 90) {
		mean = (mean + 180) % 360;
	}
	return mean;
}

// random number float
_global.rand = function(num){
	return num * Math.random();
}

// random int -1 or 1
_global.randDir = function(){
	return !random(2) ? -1 : 1;
}

// plus or minus random amount
_global.jitter = function(amount){
	return -amount * .5 + amount * Math.random();
}

// random position on object
_global.randomPointOn = function(mc){
	var w = mc.radius || (mc._width * .5);
	var h = mc.radius || (mc._height * .5);
	return {_x:mc._x + jitter(w * 2), _y:mc._y + jitter(h * 2), _rotation:mc._rotation};
}

// random true|false based on average true-per-second
_global.randomPerSecond = function(perSecond){
	return random(frameScale / perSecond) == 0;
}