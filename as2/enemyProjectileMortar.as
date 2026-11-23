// ENEMY MORTAR SHELL
// flies in an arc over everything (walls too) from where it was fired to (targetX, targetY),
// growing toward the top of the arc as if coming at the camera, and bursts where it lands.
// A red ring on the ground marks the spot, closing in as the shell comes down.
// Init props: targetX, targetY; params: speed (px a frame across the ground), arcHeight
// (extra size at the top of the arc, 1 = double), damage + blastRange (the burst).

stop();

// init
var original = _parent[stripNums(_name)];
original._visible = false;
if(this != original)
	_root.shots.push(this);

// params
if(damage == undefined) damage = 30;
if(speed == undefined) speed = 6;
if(arcHeight == undefined) arcHeight = 1.2;
if(blastRange == undefined) blastRange = 60;
if(blastMark == undefined) blastMark = 2;
if(frag == undefined) frag = "";
if(fragCount == undefined) fragCount = 0;
if(targetX == undefined) targetX = _x;
if(targetY == undefined) targetY = _y;

// vars
var startX = _x, startY = _y;
var flightX = targetX - startX, flightY = targetY - startY;
var flightTime = Math.max(20, Math.sqrt(flightX * flightX + flightY * flightY) / speed);
var flightT = 0;
var marker = null;

// the landing marker
if(this != original){
	var md = shotID();
	marker = _screen.createEmptyMovieClip("mortarMark" + md, md);
	marker._x = targetX;
	marker._y = targetY;
	var r = blastRange * .5, n = 16;
	marker.lineStyle(2, 0xFF3A1A, 90);
	marker.moveTo(r, 0);
	for(var k = 1; k <= n; k++)
		marker.lineTo(Math.cos(k / n * Math.PI * 2) * r, Math.sin(k / n * Math.PI * 2) * r);
	marker.lineStyle(1, 0xFF3A1A, 60);
	marker.moveTo(-r * .4, 0); marker.lineTo(r * .4, 0);
	marker.moveTo(0, -r * .4); marker.lineTo(0, r * .4);
	marker._alpha = 30;
	marker._xscale = marker._yscale = 180;
	// the marker sits under the shell
	if(marker.getDepth() > getDepth())
		marker.swapDepths(this);
}

function update(time){
	flightT += time;
	var s = Math.min(1, flightT / flightTime);
	_x = startX + flightX * s;
	_y = startY + flightY * s;
	var h = 4 * s * (1 - s);
	_xscale = _yscale = 100 * (1 + arcHeight * h);
	_rotation += 9 * time;
	if(marker){
		marker._xscale = marker._yscale = 180 - 80 * s;
		marker._alpha = 30 + 70 * s;
		marker._rotation -= 4 * time;
	}
	if(s >= 1)
		land();
	else if(randomPerSecond(15))
		makeShrapnel(this, "particle_mcDust", 1, 360, {scale:40 + 60 * h});
}

function land(){
	_root.shots.remove(this);
	if(marker)
		marker.removeMovieClip();
	_xscale = _yscale = 100;
	makeExplosion(this);
	if(blastMark) makeBlastmark(this, blastMark);
	if(fragCount) makeShrapnel(this, frag, fragCount);
	_rotation = rand(360);
	gotoAndPlay(2);
}
