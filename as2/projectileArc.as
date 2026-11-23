// PROJECTILE ARC (the Arc Caster, first found in level 10 Interface)
// Instant chain lightning. The arc strikes the nearest robot or crate in front of the ship (within
// `range` and `cone` degrees of the aim, in line of sight), then jumps to the nearest robot it
// hasn't hit yet within `jumpRange` of the last one, up to `chain` strikes. Each jump does
// `falloff` of the damage before it and stuns a little. With nothing in reach it crackles out
// to the first wall.

// params
if(damage == undefined) damage = 20;
if(range == undefined) range = 200;
if(cone == undefined) cone = 32;
if(jumpRange == undefined) jumpRange = 120;
if(chain == undefined) chain = 4;
if(falloff == undefined) falloff = .7;
if(stun == undefined) stun = 6;
if(fadeSpeed == undefined) fadeSpeed = 22;
if(arcColor == undefined) arcColor = 0xA8E8FF;

// init
var original = _parent[stripNums(_name)];
if(this != original)
	_root.shots.push(this);
else
	_visible = false;

function arcAngleDiff(a, b){
	var d = (a - b) % 360;
	if(d > 180) d -= 360;
	if(d < -180) d += 360;
	return Math.abs(d);
}

// the nearest target to `from` within reach, skipping those already struck
function arcFind(from, reach, aim, struck, withBoxes){
	var best = null, bestD = reach * reach;
	var lists = withBoxes ? [_root.enemies, _root.boxes] : [_root.enemies];
	for(var l = 0; l < lists.length; l++){
		var list = lists[l];
		for(var i = 0; i < list.length; i++){
			var mc = list[i];
			if(mc._currentframe != 1 || mc.health <= 0 || !mc._visible)
				continue;
			var seen = false;
			for(var k = 0; k < struck.length; k++)
				if(struck[k] == mc) seen = true;
			if(seen)
				continue;
			var d = getDistanceSquare(from, mc);
			if(d >= bestD)
				continue;
			if(aim != undefined && arcAngleDiff(getAngle(from, mc), aim) > cone)
				continue;
			if(!lineOfSight(from, mc, 8))
				continue;
			best = mc;
			bestD = d;
		}
	}
	return best;
}

// a jagged bolt from a to b, drawn in this clip (which sits at the muzzle, unrotated)
function arcBolt(a, b, width, alpha){
	var dx = b._x - a._x, dy = b._y - a._y;
	var len = Math.sqrt(dx * dx + dy * dy);
	var n = Math.max(2, int(len / 14));
	var nx = -dy / len, ny = dx / len;
	lineStyle(width, arcColor, alpha);
	moveTo(a._x - origin._x, a._y - origin._y);
	for(var i = 1; i < n; i++){
		var f = i / n, j = jitter(Math.min(10, len / 8));
		lineTo(a._x + dx * f + nx * j - origin._x, a._y + dy * f + ny * j - origin._y);
	}
	lineTo(b._x - origin._x, b._y - origin._y);
}

if(this != original){
	origin = {_x:_x, _y:_y};
	var aim = _rotation;
	_rotation = 0;
	blendMode = "add";
	var struck = [];
	var points = [origin];
	var from = origin, dmg = damage;
	var target = arcFind(origin, range, aim, struck, true);
	while(target && struck.length < chain){
		struck.push(target);
		points.push({_x:target._x, _y:target._y});
		_root.stats.hits++;
		target.hit(getDamage(dmg), getAngle(from, target));
		if(target.stunned != undefined && target.health > 0){
			target.stunned += stun;
			if(!random(2))
				makeZaps(target, 10);
		}
		makeSparks(target, 100);
		from = {_x:target._x, _y:target._y};
		dmg *= falloff;
		target = arcFind(from, jumpRange, undefined, struck, false);
	}
	if(struck.length == 0){
		// nothing in reach: crackle forward to the first wall (or the end of the range)
		var v = getVector(6, aim), p = {_x:origin._x, _y:origin._y}, d = 0;
		while(d < range * .6 && !wallHitTest(p._x, p._y)){
			p._x += v.x;
			p._y += v.y;
			d += 6;
		}
		points.push(p);
		if(wallHitTest(p._x, p._y)){
			makeSparks(p, 60);
			makeBlastmark(p, 8);
		}
	}
	// bolts: a wide faint glow pass under a thin bright core
	for(var i = 1; i < points.length; i++){
		arcBolt(points[i - 1], points[i], 6, 25);
		arcBolt(points[i - 1], points[i], 2, 100);
	}
	filters = [new flash.filters.GlowFilter(0x3FA8FF, 1, 10, 10, 2, 1)];
}

function update(){
	if(_alpha - fadeSpeed <= 0){
		_root.shots.remove(this);
		this.kill();
	}else{
		_alpha -= fadeSpeed;
	}
}
