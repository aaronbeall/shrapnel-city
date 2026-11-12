// ENEMY base class

// init
stop();
_name = "enemy_mc" + getDepth();
_root.enemies.push(this);

// hit
function hit(damage, angle){
	// implement hit() to respond to shots/explosions
	die();
}

// update
function update(){
	// implement update() to perform actions during the main loop
}

// remove enemy from update loop and play death animation
function die(){
	_root.stats.kills++;
	_root.enemies.remove(this);
	gotoAndPlay(2);
}