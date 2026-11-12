// UI MISSION PANEL

// init
stop();
var isShowing = false;
close_btn.enabled = false;

// show the panel
function show(){
	gotoAndPlay("in");
	isShowing = true;
}

// hide the panel
function hide(){
	gotoAndPlay("out");
	isShowing = false;
	close_btn.enabled = false;
}

// toggle the mission panel
function toggle(){
	if(!isShowing)
		show();
	else
		hide();
}

function onInComplete(){
	stop();
	close_btn.enabled = true;
}

function onOutComplete(){
	stop();
}