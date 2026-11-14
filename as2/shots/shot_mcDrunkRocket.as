// instance shot_mcDrunkRocket on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	damage = 25;
	speed = 10 + rand(10);
	blastRange = 50;
	blastMark = 11;
	blastInit = {scale:[75,75]};
	
	var angle = 0, angleJitter = 6, time = 0, timer = 60;
	function onUpdate(){
		angle += jitter(angleJitter);
		_rotation += angle;
		
		trajectory = getVector(speed,_rotation);
		samples = Math.ceil(speed/sampleSize);
		xSample = trajectory.x/samples;
		ySample = trajectory.y/samples;
		
		if(++time > timer) hitFunc();
	}
	
	function onSample(){
		makeSmoke(this, 15, 15);
	}
}
