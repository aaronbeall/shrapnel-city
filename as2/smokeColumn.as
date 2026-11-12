// SMOKE COLUMN

// init
_name = "smokeColumn_mc" + getDepth();
_root.shots.push(this);
if(!lifespan) frameRate * 3;

// vars
var time = 0;
var SMOKE_INTERVAL = int(frameRate / 4);

// update
function update(){
	if(++time > lifespan){
		_root.shots.remove(this);
		this.kill();
	}else if(!(time % SMOKE_INTERVAL)){
		var percent = 1 - (time / lifespan);
		makeSmoke(this, 50 * percent, 2, 1, {x:.3 + jitter(.25), y:-.75 - jitter(.25)});
	}
	if(randomPerSecond(2))
		makeSparks(this);
}