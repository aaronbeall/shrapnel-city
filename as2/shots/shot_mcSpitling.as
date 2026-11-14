// instance shot_mcSpitling on screen_mc, frame 2 (moved from the FLA instance script)
onClipEvent(load){
	// params
	type = "bomblet";
	speed = 25 + rand(25);
	bounce = 0.35;
	drag = .85;
	damage = 50;
	blastRange = 75;
	spinSpeed = 25;
	blastMark = 2;
	blastInit = {scale:[50,50]};
	sampleSize = 5;
}
