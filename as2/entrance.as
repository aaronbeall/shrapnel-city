gotoAndPlay("warp");
_player._x = _x;
_player._y = _y;
_player._rotation = _rotation;
	
function onWarpComplete(){
	_player.spawn();
	makeShrapnel(_player, "particle_mcBlue", 100, 360);
	makeZaps(this, 30);
	makeLightFlash(this);
	if(speed)
		_player.thrust(speed, _player._rotation);
}