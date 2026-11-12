// LEVEL FUNCTIONS
// functions for managing the level setup and progression

// level definitions
var levels = [
	{name: "00_Training"},
	{name: "01_DropZone"},
	{name: "02_FirstBlock"},
	{name: "03_Bridge"},
	{name: "04_Urban"},
	{name: "05_Gateway"},
	{name: "06_Downtown"},
	{name: "07_Shipyard"},
	{name: "08_Bunker"},
	{name: "09_Complex"},
	{name: "10_Interface"},
	{name: "11_Skyrise"},
	{name: "12_Transit"},
	{name: "13_Security"},
	{name: "14_Core"}//,
	/*{name: "15_Escape"},
	{name: "16_Outskirts"},
	{name: "17_Outpost"},
	{name: "18_Docking"},
	{name: "19_Deep Space"},
	{name: "20_Station"},
	{name: "21_Central"},
	{name: "22_Source"},
	{name: "23_Terminate"}*/
]

// vars
var so = SharedObject.getLocal('shrapnel');
var currentLevel = null;
var currentIndex = 0;

// go to a level by index
_global.gotoLevel = function(index){
	trace("[GOTO LEVEL] " + index)
	//if(!so.data) return;
	currentIndex = index;
	_root.gotoAndStop("game");
	_root.screen_mc.gotoAndStop((index * 2) + 1);
	//_root.HUD_mc._visible = false;
}

// start a level
_global.startLevel = function(){
	
	var name = levels[currentIndex].name;
	
	trace("[START LEVEL] " + currentIndex + ' "' + name + '"');
	
	// init
	currentLevel.name = name;
	_root.HUD_mc._visible = true;
	_root.HUD_mc.level_txt.text = name.toUpperCase();
	_screen.vision_mc._visible = false;
	//_screen.blasts_mc.cacheAsBitmap = true;
	//_screen.level_mc.cacheAsBitmap = true;
	_screen.powerups_mc.cacheAsBitmap = true;
	
	// global variables
	_global.levelWidth = _screen.level_mc._width;
	_global.levelHeight = _screen.level_mc._height;
	
	// level collisions bitmap
	_global.level_bmp = new flash.display.BitmapData(levelWidth, levelHeight, false, 0x000000);
	level_bmp.draw(_screen.level_mc);
	_screen.level_mc.kill();
	
	// blasts bitmap
	//_global.blasts_bmp = new flash.display.BitmapData(levelWidth, levelHeight, true, 0x000000);
	//_screen.blasts_mc.attachBitmap(blasts_bmp,1);
	
	// background bitmap
	_global.background_bmp = new flash.display.BitmapData(levelWidth, levelHeight, false, 0xFF626A67);
	background_bmp.draw(_screen.background_mc);
	_screen.background_mc.swapDepths(_screen.getNextHighestDepth());
	_screen.background_mc.removeMovieClip();
	var mc = _screen.backgroundContainer_mc.createEmptyMovieClip("bmp_mc", 1);
	mc.attachBitmap(background_bmp, 1);
	
	// indicate player location
	setTimeout(_player.indicate, 100, 'new');
	
	// start main game loop
	_root.onEnterFrame = _root.coreLoop;
	
	// set quality setting
	_root._quality = currentQuality;
	
	// activate scrolling if necessary
	_player.scrolling = levelWidth > screenWidth || levelHeight > screenHeight;
	
	setTimeout(function(){
		trace([_root.enemies.length + " enemies", _root.boxes.length + " boxes"])
		//_root.scrollRect = _root.rect;
	}, 10);
}

// level completed
_global.completeLevel = function(){
	trace("[COMPLETE LEVEL] " + currentIndex);
	currentLevel.completed = true;
	currentIndex++;
	_root.saveLevel(currentIndex);
	endLevel();
	_screen.nextFrame();
}

// level lost, click retry
_global.retryLevel = function(){
	trace("[RETRY LEVEL]");
	endLevel();
	_screen.prevFrame();
}

// level ended
_global.endLevel = function(){
	trace("[END LEVEL]");
	
	var p = _player;
	
	// snapshot screen for smooth transition
	var bmp = new flash.display.BitmapData(levelWidth, levelHeight, false, 0xFF626A67);
	bmp.draw(_root);
	_screen.backgroundContainer_mc.bmp_mc.attachBitmap(bmp, 1);
	
	// purge level
	blasts_bmp.dispose();
	background_bmp.dispose();
	//_screen.backgroundContainer_mc.bmp_mc.removeMovieClip();
	var i = shots.length;
	while(i--)
		shots[i].removeMovieClip();
	for(var mc in p.blasts_mc)
		p.blasts_mc[mc].removeMovieClip();
	
	// reset variables
	_root.boxes = [];
	_root.enemies = [];
	_root.powerups = [];
	_root.shots = [];
	_root.zones = [];
	_root.triggers = [];
	_root.paths = {};
	
	// disable player
	p.hide();
	_root.HUD_mc._visible = false;
	
	// kill the main loop
	_root.onEnterFrame = null;
	
	// reset quality for menus
	_root._quality = "HIGH";
	
	// restore screen to center
	_screen._x = _screen._y = 0;
	
	_root.scrollRect = null;
}

// continue player state in level
_global.continueLevel = function(){
	trace("[CONTINUE LEVEL] " + currentIndex);
	
	_screen.nextFrame();
	_root.loadLevel(currentIndex);
}

/*// _changing between a multi zone level
_global.changeZone = function(num){
	saveZone();
	_screen.gotoAndStop(_screen._currentframe + num);
	loadZone();
}

// save zone state
_global.saveZone = function(){
	var z = zones[_screen._currentframe] = {};
	
	// save bitmaps
	z.blasts_bmp = blasts_bmp.clone();
	
	// save enemy state
	z.enemies = [];
	for(var mc in _screen.enemies_mc){
		var enemy = _screen.enemies_mc[mc];
		var obj = {
			name:enemy._name,
			health:enemy.health,
			rotation:enemy._rotation,
			turretRotation:enemy.turret_mc._rotation
		}
		z.enemies.push(obj);
	}
	
	// save box state
	z.boxes = [];
	for(var mc in _screen.boxes_mc){
		var box = _screen.boxes_mc[mc];
		var obj = {
			name:box._name,
			health:box.health,
			rotation:box._rotation
		}
		z.boxes.push(obj);
	}
	
	// save powerup state
	z.powerups = {};
	for(var mc in _screen.powerups_mc)
		z.powerups[_screen.powerups_mc[mc].name] = true;
}

// load zone state
_global.loadZone = function(){
	var z = zones[_screen._currentframe];
	if(!z) return;
	
	// load bitmaps
	_screen.blasts_bmp.draw(z.blasts_bmp);
	
	// load enemy state
	for(var e in z.enemies){
		for(var p in z.enemies[e])
			_screen.enemies_mc[z.enemies.name][p] = z.enemies[e][p]
	}
	
	// load box state
	for(var b in z.boxes){
		for(var p in z.boxes[be])
			_screen.boxes_mc[z.boxes.name][p] = z.enemies[e][p]
	}
	
	// load powerup state
	for(var mc in _screen.powerups_mc){
		var powerup = _screen.powerups_mc[mc];
		if(!z.powerups[powerup._name])
			powerup.kill();
	}
}*/

// quit level
_global.quit = function(){
	trace("[QUIT]");
	hideDialog();
	endLevel();
	_root.gotoAndPlay('main');
}

// save/load level state
function saveLevel(index){
	trace("[SAVE LEVEL] " + index);
	
	var d = so.data, p = _player;
	if(!d.levels)
		d.levels = {};
	var lvl = d.levels["lvl" + index] = {};
	lvl.health = p.health;
	lvl.healthMax = p.healthMax;
	lvl.weapons1 = [];
	for(var w in p.weapons1)
		lvl.weapons1[w] = p.weapons1[w].ammo;
	lvl.weapons2 = [];
	for(var w in p.weapons2)
		lvl.weapons2[w] = p.weapons2[w].ammo;
	lvl.wep1ID = p.weapon1.id;
	lvl.wep2ID = p.weapon2.id;
	lvl.inventory = [];
	for(var i in _inventory.items)
		lvl.inventory[i] = {name:_inventory.items[i].name, label:_inventory.items[i].label};
	if(!d.level || d.level < index)
		d.level = index;
	so.flush();
	return lvl;
}
function loadLevel(index){
	trace("[LOAD LEVEL] " + index);
	
	var d = so.data, p = _player;
	var lvl = d.levels["lvl" + index];
	if(!lvl){
		// this should only happen for the first level the first time the game is played
		trace(" ---> no level data saved for lvl" + index);
		lvl = saveLevel(index);
		currentLevel = lvl;
		return;
	}
	p.health = lvl.health;
	p.healthMax = lvl.healthMax;
	for(var w in lvl.weapons1)
		p.weapons1[w].ammo = lvl.weapons1[w];
	for(var w in lvl.weapons2)
		p.weapons2[w].ammo = lvl.weapons2[w];
	p.weapon1 = p.weapons1[lvl.wep1ID];
	p.weapon2 = p.weapons2[lvl.wep2ID];
	_inventory.reset(lvl.inventory);
	
	currentLevel = lvl;
	currentIndex = index;
	
	updateDisplay();
}
