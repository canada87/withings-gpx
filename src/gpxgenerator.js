const dateFormat = require('dateformat');

// a heartrate sample is attached to a location point only if it is closer than this
const MAX_HEARTRATE_DELTA_SECONDS = 10;

/**
 * The class converts the withings data into a GPX file
 */
class GpxGenerator {

    /**
     * This method fetches the details of the activity
     * and generates a GPX file
     * @param {Activity} selectedActivity the activity
     * received from allActivities
     * @param {boolean} fullHeartrateTimeline false: one point for every location sample
     * (the heartrate is lost where there is no location sample close to it).
     * true: the heartrate samples without a close location sample become points too
     */
    async generateGpxFromActivity(selectedActivity, fullHeartrateTimeline){
        console.log(selectedActivity);
        let heartrateData = await activity
                            .getHeartrateData(selectedActivity.startdate, selectedActivity.enddate);
        let locationData = await activity
                            .getLocationData(selectedActivity.startdate, selectedActivity.enddate);
        let startDate = new Date(selectedActivity.startdate * 1000);
        let name = 'Withings activity ' + dateFormat(startDate, 'yyyy-mm-dd HH:MM');
        return this.generateGpx(locationData, heartrateData, name, fullHeartrateTimeline);
    }

    /**
     * This method generates a GPX file
     * @param {object} locationData The locationdata received from withings
     * @param {object} heartrateData The heartrate data received from withings
     * @param {string} name the name of the track, shown by the platform
     * that imports the file
     * @param {boolean} fullHeartrateTimeline see generateGpxFromActivity
     * @return {string} contents of the GPX file
     */
    generateGpx(locationData, heartrateData, name, fullHeartrateTimeline){
        if(!locationData || !locationData.vasistas || locationData.vasistas.length === 0){
            throw new Error('No GPS data available for this activity');
        }
        if(!heartrateData || !heartrateData.vasistas){
            heartrateData = {dates: [], vasistas: []};
        }

        var points = this.buildPoints(locationData, heartrateData, fullHeartrateTimeline);
        var result = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1/gpx.xsd"><trk><name>' + this.escapeXml(name || 'Withings activity') + '</name><trkseg>';

        points.forEach(function(point){
            result += '<trkpt lat="' + point.latitude + '" lon="' + point.longitude + '"><time>';
            result += new Date(point.timestamp*1000).toISOString();
            result += '</time>';
            if(point.heartrate !== null){
                result += '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>';
                result += point.heartrate;
                result += '</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>';
            }
            result += '</trkpt>';
        });
        result += '</trkseg></trk></gpx>';
        return result;
    }

    /**
     * Creates the list of track points. Every location sample is a point, with the
     * closest heartrate sample if there is one within 10 seconds.
     * With fullHeartrateTimeline the heartrate samples that have no location sample
     * within 10 seconds become points as well, placed at the last known location
     * (or at the first one if the heartrate starts before the first location).
     * This keeps the heartrate of activities with few or no location changes,
     * like indoor cycling. The points are then sorted by time.
     * @param {object} locationData The locationdata received from withings
     * @param {object} heartrateData The heartrate data received from withings
     * @param {boolean} fullHeartrateTimeline add the heartrate only points
     * @return {Array} points with timestamp, latitude, longitude and heartrate (or null)
     */
    buildPoints(locationData, heartrateData, fullHeartrateTimeline){
        var points = [];

        for(var i = 0; i < locationData.vasistas.length; i++){
            let timestamp = locationData.dates[i];
            var heartrateDelta = 99999;
            var heartrate = 0;

            for(var j = 0; j < heartrateData.dates.length; j++){
                let heartrateTime = heartrateData.dates[j]
                let delta = Math.abs(timestamp - heartrateTime);
                if(delta < heartrateDelta){
                    heartrateDelta = delta;
                    heartrate = heartrateData.vasistas[j][0];
                }
            }
            points.push({
                timestamp: timestamp,
                latitude: locationData.vasistas[i][0],
                longitude: locationData.vasistas[i][1],
                heartrate: heartrateDelta < MAX_HEARTRATE_DELTA_SECONDS ? heartrate : null
            });
        }

        if(!fullHeartrateTimeline){
            return points;
        }

        var locationPoints = points.slice();
        for(var h = 0; h < heartrateData.dates.length; h++){
            let heartrateTime = heartrateData.dates[h];
            let value = heartrateData.vasistas[h][0];
            if(!(value > 0)){
                continue;
            }

            var hasCloseLocation = false;
            var lastKnown = locationPoints[0];
            for(var k = 0; k < locationPoints.length; k++){
                let locationTime = locationPoints[k].timestamp;
                if(Math.abs(locationTime - heartrateTime) < MAX_HEARTRATE_DELTA_SECONDS){
                    hasCloseLocation = true;
                    break;
                }
                if(locationTime <= heartrateTime){
                    lastKnown = locationPoints[k];
                }
            }
            if(!hasCloseLocation){
                points.push({
                    timestamp: heartrateTime,
                    latitude: lastKnown.latitude,
                    longitude: lastKnown.longitude,
                    heartrate: value
                });
            }
        }

        points.sort((a, b) => a.timestamp - b.timestamp);
        return points;
    }

    /**
     * Escapes the characters that are not allowed in XML text
     * @param {string} text the text to escape
     * @return {string} the escaped text
     */
    escapeXml(text){
        return String(text)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;');
    }
}
module.exports = GpxGenerator
