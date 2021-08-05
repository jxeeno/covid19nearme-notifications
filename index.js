const axios = require('axios');
const { MongoClient } = require('mongodb');
const config = require('config');
const lodash = require('lodash');
const moment = require('moment-timezone');
const tweetThread = require('./tweet');

const uri = config.get("mongo.uri");
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });

const HEADERS = {
    VIC: 'COVID-19 Near Me updated with latest info from @VicGovDH (%time%):',
    NSW: 'COVID-19 Near Me updated with latest info from @NSWHealth (%time%):',
    QLD: 'COVID-19 Near Me updated with latest info from @qldhealthnews (%time%):',
    SA: 'COVID-19 Near Me updated with latest info from @SAHealth (%time%):',
    WA: 'COVID-19 Near Me updated with latest info from @WAHealth (%time%):',
    NT: 'COVID-19 Near Me updated with latest info from NT Health (%time%):',
    ACT: 'COVID-19 Near Me updated with latest info from @ACTHealth (%time%):',
    NZ: 'COVID-19 Near Me updated with latest info from @minhealthnz (%time%):',
}

const TZS = {
    VIC: 'Australia/Melbourne',
    NSW: 'Australia/Sydney',
    QLD: 'Australia/Brisbane',
    SA: 'Australia/Adelaide',
    WA: 'Australia/Perth',
    NT: 'Australia/Darwin',
    ACT: 'Australia/Sydney',
    NZ: 'Pacific/Auckland',
}

const FOOTERS = {
    VIC: '🔗 Official: https://www.coronavirus.vic.gov.au/exposure-sites\n🔗 View & track: https://covid19nearme.com.au/state/vic',
    NSW: '🔗 Official: https://www.nsw.gov.au/covid-19/nsw-covid-19-case-locations\n🔗 View & track: https://covid19nearme.com.au/state/nsw',
    QLD: '🔗 Official: https://www.qld.gov.au/health/conditions/health-alerts/coronavirus-covid-19/current-status/contact-tracing\n🔗 View & track: https://covid19nearme.com.au/state/qld',
    SA: '🔗 Official: https://www.sahealth.sa.gov.au/wps/wcm/connect/public+content/sa+health+internet/conditions/infectious+diseases/covid-19/testing+and+tracing/contact+tracing/contact+tracing\n🔗 View & track: https://covid19nearme.com.au/state/sa',
    WA: '🔗 Official: https://healthywa.wa.gov.au/Articles/A_E/Coronavirus/Locations-visited-by-confirmed-cases\n🔗 View & track: https://covid19nearme.com.au/state/wa',
    NT: '🔗 Official: https://coronavirus.nt.gov.au/stay-safe/case-location-alerts-and-public-exposure-sites\n🔗 View & track: https://covid19nearme.com.au/state/nt',
    ACT: '🔗 Official: https://www.covid19.act.gov.au/act-status-and-response/act-covid-19-exposure-locations\n🔗 View & track: https://covid19nearme.com.au/state/act',
    NZ: '🔗 Official: https://www.health.govt.nz/our-work/diseases-and-conditions/covid-19-novel-coronavirus/covid-19-health-advice-public/contact-tracing-covid-19/covid-19-contact-tracing-locations-interest\n🔗 Track changes at https://covid19nearme.co.nz',
    
}

const getExposureList = async (state) => {
    const {data} = await axios.get(config.get('covid19nearme.dataUri').replace('%state%', state), {
        params: {
            ts: moment().unix()
        }
    });
    return data.locations;
}

const processState = async (state, collection) => {
    // get locations
    const locations = await getExposureList(state);

    // only get locations which have at least one active exposure
    const activeLocations = locations.filter(location => location.exposures.some(exposure => !exposure.dismissed));

    const persistExposures = async (resp) => {
        const activeExposures = activeLocations.flatMap(location => location.exposures.filter(exposure => !exposure.dismissed));
        const exposureMemory = resp ? resp.exposures : {};
        for(const exposure of activeExposures){
            exposureMemory[exposure.exposureUuid] = [exposure.version]
        }
        await collection.updateOne({ state }, { $set: { exposures: exposureMemory } })
    }

    const resp = await collection.findOne({state});
    // console.log({resp});

    if(!resp){
        console.log(`Initial load of state ${state}`)
        await collection.insertOne({state});
        await persistExposures();
        return;
    }

    // const exposureMap

    const diff = {new: [], updated: []};

    for(const location of activeLocations){
        const activeExposures = location.exposures.filter(exposure => !exposure.dismissed);
        const newExposures = activeExposures.filter(exposure => !resp.exposures[exposure.exposureUuid]);
        const updatedExposures = activeExposures.filter(exposure => resp.exposures[exposure.exposureUuid] && resp.exposures[exposure.exposureUuid][0] < exposure.version);
        const unchangedExposures = activeExposures.filter(exposure => resp.exposures[exposure.exposureUuid] && resp.exposures[exposure.exposureUuid][0] >= exposure.version);
        
        let type;
        let exposureTypes = [];
        if(newExposures.length > 0 && updatedExposures.length === 0 && unchangedExposures.length === 0){
            // brand new location
            type = 'new';
            exposureTypes = newExposures.map(e => e.exposureType);
        }else if(newExposures.length > 0 || updatedExposures.length > 0){
            // updated or new times
            type = 'updated';
            exposureTypes = updatedExposures.concat(newExposures).map(e => e.exposureType);
        }

        let locationName = location.locationName;
        if(location.locationSuburb !== 'Public Transport' && !locationName.toUpperCase().includes(location.locationSuburb.toUpperCase())){
            // suburb not there
            locationName += `, ${location.locationSuburb}`
        }

        let tierIcon = '*';
        let tierPriority;
        if(exposureTypes.includes('isolate')){
            tierIcon = '🔴'
            tierPriority = 1
        }else if(exposureTypes.includes('further')){
            tierIcon = '🟤'
            tierPriority = 2
        }else if(exposureTypes.includes('negative')){
            tierIcon = '🟠'
            tierPriority = 3
        }else if(exposureTypes.includes('test')){
            tierIcon = '🟣'
            tierPriority = 4
        }else if(exposureTypes.includes('monitor')){
            tierIcon = '🔵'
            tierPriority = 5
        }

        if(type && tierIcon){
            diff[type].push([`${tierIcon} ${locationName}`, tierPriority, location.locationSuburb])
        }
    }

    diff.new = lodash.sortBy(diff.new, [o => o[1], o => o[2]]);
    diff.updated = lodash.sortBy(diff.updated, [o => o[1], o => o[2]]);

    console.log(state, diff)
    await tweetDiff(state, diff);
    
    // now remember exposure sites
    await persistExposures(resp);
}

const tweetDiff = async (state, diff) => {
    let tweets = [];

    // generate time rounded to 10 mins
    let time = moment().tz(TZS[state]);
    let remainder = 10 - (time.minute() % 10);
    time.add(remainder, "minutes");
    const timeStr = time.format('D MMM h:mma').replace(':00', '');

    const TWEET_LIMIT = 280;
    let footer = '\n' + FOOTERS[state];
    let header = HEADERS[state].replace('%time%', timeStr);

    let totalItems = diff.new.length + diff.updated.length;
    let ii = 0;

    let lastValidTweet;
    let currentLines = [];

    const urlTo23 = (tweet) => {
        // replaces url to 23 characters for tweet length calc purposes
        return tweet.replace(/https?:\/\/(www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g, Array(23).fill('X').join(''))
    }

    const iterType = (section, arr) => {
        let pendingLines = [];
        if(arr.length > 0){
            pendingLines.push('\n' + section);
        }
        
        for(let i = 0; i < arr.length; i++){
            ii++;
    
            let hasHeader = tweets.length === 0;
            let isLast = ii === totalItems;
            let hasFooter = isLast || hasHeader;
            if(isLast){
                hasFooter = true;
            }
    
            let item = arr[i];
    
            let currentTweet = (hasHeader ? [header] : ['...']).concat(currentLines, pendingLines, [item[0]], !isLast ? ['...'] : []).concat(hasFooter ? [footer] : [], hasHeader && isLast ? [] : ['\n(XX/XX)']).join('\n');
            if(urlTo23(currentTweet).length >= TWEET_LIMIT){
                tweets.push(lastValidTweet);
                currentLines = []
                hasHeader = false;
                currentTweet = (hasHeader ? [header] : ['...']).concat(currentLines, pendingLines, [item[0]], !isLast ? ['...'] : []).concat(hasFooter ? [footer] : [], hasHeader && isLast ? [] : ['\n(XX/XX)']).join('\n');
            }
    
            currentLines.push(item[0]);
            lastValidTweet = currentTweet;
            pendingLines = []
        }
    }

    iterType(`➕ ${diff.new.length} new ${diff.new.length > 1 ? 'locations' : 'location'}`, diff.new);
    iterType(`⚠️ Updated locations`, diff.updated);

    if(lastValidTweet != null){
        tweets.push(lastValidTweet);
    }

    if(tweets.length > 0){
        // replace with pagination
        tweets = tweets.map((tweet, i, arr) => tweet.replace('(XX/XX)', `(${i+1}/${arr.length})`))

        console.log(tweets)
        
        await tweetThread(tweets);
    }
}

const main = async () => {
    await client.connect();
    const db = client.db('notifications')
    const collection = db.collection('exposures');

    const states = ['SA', 'WA', 'QLD', 'NSW', 'VIC', 'ACT', 'NZ', 'NT'];

    for(const state of states){
        await processState(state, collection);
    }
}

main().finally(() => {
    client.close()
});