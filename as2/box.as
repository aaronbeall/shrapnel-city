// BOX (all must be destroyed)

// init
stop();
_name = "box_mc" + getDepth();
_root.boxes.push(this);
cacheAsBitmap = true;

// params
if(health == undefined) health = 10;
if(required == undefined) required = true;
if(debrisType == undefined) debrisType = "yellow";
if(debrisCount == undefined) debrisCount = 1 + random(3);
if(powerupDrop == undefined) powerupDrop = null;
if(spawn == undefined) spawn = "";
if(spawnCount == undefined) spawnCount = 0;
if(spawnInit == undefined) spawnInit = {};

// hit by shot or explosion
function hit(damage, angle){
	health -= damage;
	
	// die
	if(health <= 0){
		
		// explode and remove
		play();
		_root.boxes.remove(this);
		if(fixed != true && angle != undefined)
			_rotation = angle + jitter(15);
		makeShrapnel(this, "scrap_mc", random(3));
		makeShrapnel(this, "frag_mc", random(3));
		makeShrapnel(this, "debris_mc", debrisCount, 360, {debrisType:debrisType});
		if(spawnCount) makeSpawns(this, spawn, spawnCount, 0, _width + Math.random() * _width, 360, spawnInit);
		
		// drop powerup
		if(powerupDrop) makePowerup(this, powerupDrop);
		
		onDie();
		
		// if all required boxes are destroyed, open exit
		var i = _root.boxes.length;
		while(i--)
			if(_root.boxes[i].required != false)
				return;
		//if(!_root.boxes.length)
			_screen.exit_mc.open();
	}
}