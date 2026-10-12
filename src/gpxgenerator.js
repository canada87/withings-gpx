const dateFormat = require('dateformat');

/**
 * The class converts the withings data into a GPX file
 */
class GpxGenerator {
    
    /**
     * This method fetches the details of the activity 
     * and generates a GPX file
     * @param {Activity} selectedActivity the activity 
     * received from allActivities
     */
    async generateGpxFromActivity(selectedActivity){
        console.log(selectedActivity);
        let heartrateData = await activity
                            .getHeartrateData(selectedActivity.startdate, selectedActivity.enddate);
        let locationData = await activity
                            .getLocationData(selectedActivity.startdate, selectedActivity.enddate);
        let startDate = new Date(selectedActivity.startdate * 1000);
        let name = 'Withings activity ' + dateFormat(startDate, 'yyyy-mm-dd HH:MM');
        return this.generateGpx(locationData, heartrateData, name);
    }

    /**
     * This method generates a GPX file
     * @param {object} locationData The locationdata received from withings
     * @param {object} heartrateData The heartrate data received from withings
     * @param {string} name the name of the track, shown by the platform
     * that imports the file
     * @return {string} contents of the GPX file
     */
    generateGpx(locationData, heartrateData, name){
        var result = '<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1/gpx.xsd"><trk><name>' + this.escapeXml(name || 'Withings activity') + '</name><trkseg>';
        
        for(var i = 0; i < locationData.vasistas.length; i++){
            let timestamp = locationData.dates[i];
            let latitude = locationData.vasistas[i][0];
            let longitude = locationData.vasistas[i][1];
            result += '<trkpt lat="' + latitude + '" lon="' + longitude + '"><time>';
            result += new Date(timestamp*1000).toISOString();
            result += '</time>';
            
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
            if(heartrateDelta < 10){
                result += '<extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>';
                result += heartrate;
                result += '</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>';
            }

            result += '</trkpt>';
        }
        result += '</trkseg></trk></gpx>';
        return result;
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