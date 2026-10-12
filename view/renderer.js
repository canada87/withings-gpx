const Login = require('../src/withings/login.js')
const Account = require('../src/withings/account.js')
const Activity = require('../src/withings/activity.js')
const GpxGenerator = require('../src/gpxgenerator.js')
const dateFormat = require('dateformat');
const fs = require('fs')
const path = require('path')
const Preferences = require('../src/preferences')

let login = new Login()
let account = new Account()
let activity = new Activity()
let accountResult = {}
let loginResult = {}
let allActivities = []
let selectedIds = new Set()
let cardsById = new Map()
let activitiesById = new Map()
let onlyWithDistance = false
let onlyWithHeartrate = false
let lastClickedId = null
let downloading = false

let SERVICE_NAME = 'Withings-GPX';
let loginButton = document.getElementById('loginButton');
let emailInputField = document.getElementById('email');
let passwordInputField = document.getElementById('password');

// event handlers
require('electron').ipcRenderer.on('logout', logout)
loginButton.addEventListener('click', startLogin);
emailInputField.addEventListener('keypress', checkKeyAndLogin);
passwordInputField.addEventListener('keypress', checkKeyAndLogin);
document.getElementById('selectAllButton').addEventListener('click', selectAllLoaded);
document.getElementById('clearButton').addEventListener('click', clearSelection);
document.getElementById('distanceFilterButton').addEventListener('click', toggleDistanceFilter);
document.getElementById('heartrateFilterButton').addEventListener('click', toggleHeartrateFilter);
document.getElementById('downloadButton').addEventListener('click', downloadSelected);

document.addEventListener('scroll', checkScrollPositionAndPreloadIfNecessary);

/**
 * Checks how far the users scrolled, if there are only 2 full window heights left
 * to scroll, it will try to preload the next batch of activities
 */
function checkScrollPositionAndPreloadIfNecessary() {
  var scrollY = document.getScroll()[1];
  var totalHeight = document.body.clientHeight;
  var windowHeight = require('electron').remote.getCurrentWindow().getBounds().height;
  if(scrollY > totalHeight - (3 * windowHeight)) {
    getNextBatchOfActivities();
  } 
}

/**
 * Gets the scroll coordinates for the window in [x,y]
 */
document.getScroll = function() {
    var sx, sy, d = document,
        r = d.documentElement,
        b = d.body;
    sx = r.scrollLeft || b.scrollLeft || 0;
    sy = r.scrollTop || b.scrollTop || 0;
    return [sx, sy];
}

// functions
/**
 * checks if the keycode is enter, if so it starts the login function
 * @param {Event} e 
 */
function checkKeyAndLogin(e) {
  if (e.keyCode == 13) {
    startLogin();  
  }
}

/**
 * hides all panels
 */
function hideAllPanels() {
  document.getElementById('login').hidden = true;
  document.getElementById('activitiesDialog').hidden = true;
  document.getElementById('processing').hidden = true;
}

/**
 * checks if the login can automatically sign in with the keychain credentials
 */
async function startAutoLogin() {
  hideAllPanels();
  var autoLoginResult = await login.tryAutoLogin();
  if(autoLoginResult) {
    await getActivities(autoLoginResult);
  }else {
    document.getElementById('login').hidden = false;
  }
}

/**
 * deletes the credentials from the keychain and returns to the login screen
 */
async function logout() {
  await login.deleteCredentials();
  emailInputField.value = '';
  passwordInputField.value = '';

  hideAllPanels();
  document.getElementById('login').hidden = false;
}

/**
 * fetches the login and password from the UI,
 * if the login is successful, it will get the activities
 */
async function startLogin(){
  hideAllPanels();
  login.email = document.getElementById('email').value;
  login.password = document.getElementById('password').value;
  try{
      loginResult = await login.authenticate(true);
  }catch(e){
      document.getElementById('login').hidden = false;
      return;
  }
  await getActivities(loginResult);
}

/**
 * Gets the account info and starts to get the first page of activities
 * @param {LoginResult} loginResult the result of the login 
 * authenticate method
 */
async function getActivities(loginResult){
  account.setAccountAndSessionByLoginResult(loginResult)
  accountResult = await account.getUserId()

  activity.setUserIdAndSessionId(accountResult.userId, loginResult.sessionId);
  getNextBatchOfActivities();
}

/**
 * Gets the next page of activities, adds them to the full list and renders the new ones
 * @param {int} autoLoadIteration number of times it has been trying to recursively load the next page
 */
async function getNextBatchOfActivities(autoLoadIteration){
  document.getElementById('loading').hidden = false;

  //todo: define the maximum range by date pickers, now it is set to 2015
  newActivityResponse = await activity.getNextPageWithActivities(new Date(), new Date(2015,0));

  var newActivities = newActivityResponse.activities;

  //If the response comes out empty, try to load the next batch
  if(newActivities.length === 0 && !newActivityResponse.loading && !newActivityResponse.finished){
    var iteration = 1
    if (autoLoadIteration){
      iteration = autoLoadIteration + 1;
    }
    getNextBatchOfActivities(iteration);
    return;
  }

  allActivities.push.apply(allActivities, newActivities);
  document.getElementById('activitiesDialog').hidden = false;

  //Show and hide the loading or finished state
  if(newActivityResponse.loading || newActivityResponse.finished) {
    document.getElementById('loading').hidden = !newActivityResponse.loading;
    document.getElementById('finished').hidden = !newActivityResponse.finished;
    return;
  } else {
    document.getElementById('loading').hidden = true;
    document.getElementById('finished').hidden = true;
  }

  //Render the new activities, if any
  renderActivities(newActivities);
}

/**
 * Renders the list of activities in the UI
 * @param {[Activity]} allActivities list of activities
 */
function renderActivities(allActivities){
  let activityDiv = document.getElementById('activities')
  
  allActivities.forEach(function(activity){
    var newDiv = renderActivityDiv(activity);
    newDiv.addEventListener('click', function(event){
      toggleSelection(activity.id, event.shiftKey);
    })

    cardsById.set(activity.id, newDiv);
    activitiesById.set(activity.id, activity);
    newDiv.hidden = !passesFilter(activity);
    activityDiv.appendChild(newDiv)
  });

  checkScrollPositionAndPreloadIfNecessary();
}

/**
 * generates an activity element
 * @param {Activity} activity a single activity
 * @return {HTMLElement} acitivity HTML element DIV
 */
function renderActivityDiv(activity) {
  var newDiv = document.createElement('div');
  let startDate = new Date(activity.startdate * 1000);
  newDiv.innerHTML = '<h3><span class="check"></span>Activity started on '
                      + dateFormat(startDate, 'dd mm yyyy')
                      + ' at '
                      + dateFormat(startDate, 'HH:MM') + ' </h3>';
  newDiv.innerHTML += '<div class="info maxheartrate"><div class="label">'
                      + 'average HR</div><div class="value">' 
                      + activity.data.hr_average 
                      + '<span>bpm</span></div></div>';
  newDiv.innerHTML += '<div class="info minheartrate"><div class="label">' 
                      + 'average speed</div><div class="value">' 
                      + Math.round(activity.gps.avg_speed * 3.6 * 100) / 100 
                      + '<span>km/h</span></div></div>';
  newDiv.innerHTML += '<div class="info distance"><div class="label">' 
                      + 'distance</div><div class="value">' 
                      + Math.round((activity.gps.distance) / 10) / 100 
                      + '<span>km</span></div></div>';
  newDiv.innerHTML += '<div class="info calories"><div class="label">'
                      + 'calories</div><div class="value">' 
                      + Math.round(activity.data.manual_calories) 
                      + '<span>kcal</span></div></div>';
  newDiv.dataset.activityId = activity.id;
  return newDiv;
}

/**
 * Selects or deselects a single activity card
 * @param {number} id the activity id
 * @param {boolean} selected whether the activity should be selected
 */
function setSelected(id, selected) {
  var card = cardsById.get(id);
  if (!card) {
    return;
  }
  if (selected) {
    selectedIds.add(id);
  } else {
    selectedIds.delete(id);
  }
  card.classList.toggle('selected', selected);
}

/**
 * Toggles the selection of an activity. With shift pressed, every activity
 * between the last clicked one and this one gets the same state.
 * @param {number} id the activity id
 * @param {boolean} range true if a range should be (de)selected
 */
function toggleSelection(id, range) {
  var select = !selectedIds.has(id);
  var ids = Array.from(cardsById.keys()).filter(i => !cardsById.get(i).hidden);

  if (range && lastClickedId !== null && ids.includes(lastClickedId)) {
    var bounds = [ids.indexOf(lastClickedId), ids.indexOf(id)].sort((a, b) => a - b);
    ids.slice(bounds[0], bounds[1] + 1).forEach(i => setSelected(i, select));
  } else {
    setSelected(id, select);
  }

  lastClickedId = id;
  updateToolbar();
}

/**
 * Checks if an activity is shown with the current filters
 * @param {Activity} activity a single activity
 * @return {boolean} true if the activity has to be shown
 */
function passesFilter(activity) {
  if (onlyWithDistance && !(activity.gps && activity.gps.distance > 0)) {
    return false;
  }
  if (onlyWithHeartrate && !(activity.data && activity.data.hr_average > 0)) {
    return false;
  }
  return true;
}

/**
 * Turns the "distance > 0" filter on or off
 */
function toggleDistanceFilter() {
  onlyWithDistance = !onlyWithDistance;
  document.getElementById('distanceFilterButton').classList.toggle('active', onlyWithDistance);
  applyFilters();
}

/**
 * Turns the "average HR > 0" filter on or off
 */
function toggleHeartrateFilter() {
  onlyWithHeartrate = !onlyWithHeartrate;
  document.getElementById('heartrateFilterButton').classList.toggle('active', onlyWithHeartrate);
  applyFilters();
}

/**
 * Shows only the activities that pass all the active filters. Activities that
 * become hidden are deselected, so a download never includes something that is
 * not visible.
 */
function applyFilters() {
  cardsById.forEach((card, id) => {
    card.hidden = !passesFilter(activitiesById.get(id));
    if (card.hidden) {
      setSelected(id, false);
    }
  });
  if (lastClickedId !== null && cardsById.get(lastClickedId).hidden) {
    lastClickedId = null;
  }

  updateToolbar();
  // fewer cards may leave too little to scroll, so the next batch has to be requested
  checkScrollPositionAndPreloadIfNecessary();
}

/**
 * Selects all the activities that are currently shown
 */
function selectAllLoaded() {
  cardsById.forEach((card, id) => setSelected(id, !card.hidden));
  updateToolbar();
}

/**
 * Deselects all the activities
 */
function clearSelection() {
  cardsById.forEach((card, id) => setSelected(id, false));
  lastClickedId = null;
  updateToolbar();
}

/**
 * Updates the selection counter and the state of the toolbar buttons
 */
function updateToolbar() {
  document.getElementById('selectionCount').textContent = selectedIds.size + ' selected';
  document.getElementById('downloadButton').disabled = selectedIds.size === 0 || downloading;
  document.getElementById('clearButton').disabled = selectedIds.size === 0;
}

/**
 * Asks for a destination folder and saves a GPX file for every selected activity.
 * The activity list stays in place, so the scroll position is not lost.
 */
async function downloadSelected() {
  if (downloading || selectedIds.size === 0) {
    return;
  }

  const { dialog, app } = require('electron').remote;
  const preferences = new Preferences();
  const lastSaveDir = await preferences.getLastSaveDir();

  const { canceled, filePaths } = await dialog.showOpenDialog(null, {
    title: 'Choose the folder where the GPX files will be saved',
    defaultPath: typeof lastSaveDir === 'string' ? lastSaveDir : app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory']
  });
  if (canceled || !filePaths || filePaths.length === 0) {
    return;
  }
  const targetDir = filePaths[0];

  // keep the order of the list, oldest loaded last
  const toDownload = allActivities.filter(a => selectedIds.has(a.id));
  const failures = [];
  let saved = 0;

  downloading = true;
  updateToolbar();
  document.getElementById('processing').hidden = false;

  for (let i = 0; i < toDownload.length; i++) {
    const selectedActivity = toDownload[i];
    const startDate = new Date(selectedActivity.startdate * 1000);
    const fileName = 'activity_' + dateFormat(startDate, 'ddmmyyyy_HHMM') + '.gpx';
    document.getElementById('progressText').textContent =
      (i + 1) + ' of ' + toDownload.length + ': ' + fileName;

    try {
      const gpxContent = await (new GpxGenerator())
                          .generateGpxFromActivity(selectedActivity);
      fs.writeFileSync(path.join(targetDir, fileName), gpxContent, 'utf-8');
      setSelected(selectedActivity.id, false);
      saved++;
    } catch (e) {
      failures.push(fileName + ': ' + e);
    }
  }

  document.getElementById('processing').hidden = true;
  downloading = false;
  updateToolbar();

  if (saved > 0) {
    await preferences.updateLastSaveDir(path.join(targetDir, 'x'));
  }

  var message = saved + ' of ' + toDownload.length + ' files saved in ' + targetDir;
  if (failures.length > 0) {
    message += '\n\nFailed (still selected, you can retry):\n' + failures.join('\n');
  }
  alert(message);
}

startAutoLogin();