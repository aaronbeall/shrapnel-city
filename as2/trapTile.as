// TRAP TILE (first used by level 10 Interface)
// A floor grid that goes live and hurts the player's ship while it is over it. Enemies are
// unaffected (the robots own the floor). A tile is 40 x 40 px at scale 1; scale or stretch it to
// cover a strip.
//
// Timed tiles cycle on their own: dead for offTime seconds (the last warnTime of it flickering
// amber), then live for onTime seconds. Tiles in a group answer triggers:
//   "<group>:alarm"  go live for alarmTime seconds (a dormant tile wakes up for that long)
//   "<group>:on"     go live for good
//   "<group>:off"    shut down for good (e.g. a breaker box's onDie)
// A dormant tile does nothing until its group's alarm. offTime 0 means "live the whole time it's on".

stop();
_name = "trapTile_mc" + getDepth();

// params
if(onTime == undefined) onTime = 1.5;
if(offTime == undefined) offTime = 1.5;
if(warnTime == undefined) warnTime = .6;
if(phase == undefined) phase = 0;
if(shockDamage == undefined) shockDamage = 2;
if(hitRate == undefined) hitRate = 4;
if(dormant == undefined) dormant = false;
if(alarmTime == undefined) alarmTime = 10;
if(group == undefined) group = "";

// vars
var DEAD = 0, WARN = 1, LIVE = 2;
var t = phase * frameRate;
var active = !dormant;
var activeLeft = Infinity;
var warnLeft = 0;
var hitTime = 0;
var tileState = DEAD;
var halfW = 20 * _xscale / 100;
var halfH = 20 * _yscale / 100;
var cosR = Math.cos(-_rotation * Math.PI / 180), sinR = Math.sin(-_rotation * Math.PI / 180);
live_mc._visible = warn_mc._visible = false;
led_mc._visible = !dormant;

// triggers
if(group){
	registerTrigger(this, group + ":alarm");
	registerTrigger(this, group + ":on");
	registerTrigger(this, group + ":off");
	onTrigger = function(id){
		if(id == group + ":off"){
			active = false;
			dormant = true;
			group = "";
			led_mc._visible = false;
			return;
		}
		if(!group)
			return;
		if(!active || offTime <= 0)
			warnLeft = warnTime * frameRate;
		active = true;
		led_mc._visible = true;
		activeLeft = id == group + ":on" ? Infinity : alarmTime * frameRate;
	}
}

// is the player's ship over this tile? (a little inside the edges, so grazing a corner is safe)
function playerOver(){
	var dx = _player._x - _x, dy = _player._y - _y;
	var lx = dx * cosR - dy * sinR, ly = dx * sinR + dy * cosR;
	return Math.abs(lx) < halfW + 4 && Math.abs(ly) < halfH + 4;
}

function stateNow(){
	if(!active)
		return DEAD;
	if(warnLeft > 0)
		return WARN;
	if(offTime <= 0)
		return LIVE;
	var cycle = (onTime + offTime) * frameRate;
	var c = t % cycle;
	if(c < (offTime - warnTime) * frameRate)
		return DEAD;
	if(c < offTime * frameRate)
		return WARN;
	return LIVE;
}

onEnterFrame = function(){
	// only while the game runs (not under a dialog or the pause menu)
	if(_root.onEnterFrame != _root.coreLoop)
		return;
	t++;
	if(warnLeft > 0)
		warnLeft--;
	if(activeLeft != Infinity && --activeLeft <= 0){
		activeLeft = Infinity;
		active = !dormant;
		led_mc._visible = active;
		t = phase * frameRate;
	}
	tileState = stateNow();

	// graphics: amber flicker before, crackling blue while live
	warn_mc._visible = tileState == WARN && (t % 4) < 2;
	live_mc._visible = tileState == LIVE;
	if(tileState == LIVE){
		live_mc.gotoAndStop(1 + random(live_mc._totalframes));
		live_mc._alpha = 65 + random(35);
	}

	// hurt the player
	if(++hitTime >= hitRate)
		hitTime = 0;
	// (one hit per frame however many live tiles the ship straddles)
	if(tileState == LIVE && !hitTime && _player._visible && !_player.dying && _root.trapHitFrame != _root.frames && playerOver()){
		_root.trapHitFrame = _root.frames;
		_player.hitPlayer(getDamage(shockDamage), rand(360));
		makeSparks(_player, 70);
		if(!random(3))
			makeZaps(_player, 8);
	}
}
