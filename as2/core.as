// GAME CORE

// stats
stats = {
	shots:0,
	hits:0,
	bombs:0,
	kills:0
}

// variables
var boxes = []; // can be shot
var enemies = []; // can be shot, updated in main loop
var powerups = []; // triggered by player touch
var shots = []; // updated in main loop
var zones = []; // storage for zone data
var triggers = []; // storage for trigger callbacks
var paths = {}; // storage for pathfind paths
var shotCount = 0; // current shot count id
var shotMax = 10000; // max number of shots before id resets to 0
var screenDepth = 99999; // dialog screen layer
var killDepth = 999991; // layer objects to be killed are moved to

// global params
_global.screenWidth = 800;
_global.screenHeight = 600;
_global.wallThreshold = 0x000000; // blocks shots, movement, line of sight
_global.bunkerThreshold = 0x666666; // blocks movement and player shots
_global.impassThreshold = 0x999999; // blocks movement
_global.openThreshold = 0xFFFFFF; // blocks nothing
_global.frameRate = 31;
_global.timeScale = 1.0;
_global.frameScale = frameRate;

// global references
_global._player = _root.screen_mc.player_mc;
_global._screen = _root.screen_mc;
_global._inventory = _root.HUD_mc.inventory_mc;

// scrollrect - for performance, but causes hittest to fail outside screen
var rect = new flash.geom.Rectangle(0,0,screenWidth,screenHeight);
//scrollRect = rect;

// init blastmarks
var blasts = [], hit = _screen.blasts_mc.hit_mc;
for(var i = 1; i <= hit._totalframes; i++){
	hit.gotoAndStop(i);
	var bmp = new flash.display.BitmapData(hit._width, hit._height, true, 0x00000000);
	var bounds = hit.getBounds(hit._parent);
	var mat = new flash.geom.Matrix;
	mat.translate(hit._x - bounds.xMin, hit._y - bounds.yMin);
	bmp.draw(hit, mat);
	blasts[i] = {
		bmp:bmp,
		xOffset:-(hit._x - bounds.xMin),
		yOffset:-(hit._y - bounds.yMin)
	}
}

// MAIN LOOP
function coreLoop(){
	
	frames++;
	
	var time = 1;
	if(_player.hasCheated && Key.isDown(Key.SHIFT)) time = .1;
	
	_global.timeScale = time;
	_global.frameScale = frameRate / time;
	
	// update player
	_player.update(time);
	_inventory.update();
	
	// update enemies
	var e = enemies.length;
	while(e--)
		enemies[e].update(time);
	
	// update shots
	var s = shots.length;
	while(s--)
		shots[s].update(time);
	
	// udpate exit
	_screen.exit_mc.update();
	
	// shake screen
	if(shakeCount){
		if(--shakeCount <= 0){
			_x = _y = 0;
		}else{
			if(!(shakeCount % shakeInterval)){
				_x = -1 + random(3);
				_y = -1 + random(3);
			}
		}
	}
}

#include "functionsGame.as"
#include "functionsMath.as"
//#include "functionsLevel.as"
#include "functionsHelper.as"
#include "debug.as"

// IN-GAME DIALOGS
_global.showDialog = function(screen, init){
	trace("showDialog(" + screen + ")")
	_root.onEnterFrame = null;
	_root._quality = "HIGH";
	_root.attachMovie(screen, "dialogScreen_mc", _root.screenDepth, init);
	_root.dialogScreen_mc.name = screen;
}
_global.hideDialog = function(){
	trace("hideDialog")
	_root.onEnterFrame = _root.coreLoop;
	_root._quality = currentQuality;
	_root.dialogScreen_mc.removeMovieClip();
}

// QUALITY SETTING
_global.currentQuality = "HIGH";
_global.toggleQuality = function(){
	switch(currentQuality.toUpperCase()){
		case "LOW": _global.currentQuality = "MEDIUM"; break;
		case "MEDIUM": _global.currentQuality = "HIGH"; break;
		case "HIGH": _global.currentQuality = "LOW"; break;
	}
	if(_root.onEnterFrame)
		_root._quality = currentQuality;
}

// FPS COUNTER
fps_txt.background = true;
fps_txt.backgroundColor = 0x333333;
var frames = 0, framesPrev = 0;
function fps(){
	var f = frames - framesPrev;
	fps_txt.text = String(f + "/" + frameRate);
	framesPrev = frames;
	fps_txt.backgroundColor = f < frameRate - 1 ? 0x990000 : 0x333333;
}
if(!fpsInterval) var fpsInterval = setInterval(fps, 1000);