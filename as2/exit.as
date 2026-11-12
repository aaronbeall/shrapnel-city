// EXIT

// init
stop();
cacheAsBitmap = true;
var CLOSED = 0, OPENED = 1, DOCKING = 2, EXITING = 3;
var state = CLOSED;

// update
function update(){
	if(state == OPENED && !_player.dying && core_mc.hitTest(_player.core_mc)){
		state = DOCKING;
		_player.dead = _player.dying = true;
		_player.damage_mc._visible = false;
		_player.exhaust_mc._visible = false;
		_screen.shadow_mc._visible = false;
	}
	if(state == DOCKING){
		_player._x += (_x - _player._x) * .1;
		_player._y += (_y - _player._y) * .1;
		_player._rotation = smartRotation(_player._rotation, 180, _player.turnSpeed);
		_player.blasts_mc._alpha -= 5;
		if(Math.abs(_player._x - _x) < 1 && Math.abs(_player._y - _y) < 1 && Math.abs(180 - _player._rotation) < 1){
			state = EXITING;
			_player.hide();
			gotoAndPlay("exit");
		}
	}
}

function open(){
	if(state == CLOSED){
		notify(_player, "Mission complete! Get to the exit!", frameRate * 3);
		gotoAndPlay("open");
	}
}

function onOpenComplete(){
	stop();
	state = OPENED;
}

function onExitComplete(){
	stop();
	completeLevel();
}

// debug
function onPress(){
	trace("------------------------")
	trace(["boxes: " + _root.boxes.length, "enemies: " + _root.enemies.length, "shots: " + _root.shots.length]);
	trace(_root.boxes);
	trace(_root.enemies);
	trace(_root.shots);
	trace("------------------------")
	
	// cheat
	if(_player.hasCheated){
		_player._x = _x;
		_player._y = _y;
	}
}