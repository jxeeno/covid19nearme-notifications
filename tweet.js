const Twitter = require('twitter-lite');
const config = require('config');

const tweetThread = async (thread) => {
    const client = new Twitter({
        consumer_key: config.get('twitter.apiKey'),
        consumer_secret: config.get('twitter.apiSecretKey'),
        access_token_key: config.get('twitterAccounts.covid19nearmeau.accTkn'),
        access_token_secret: config.get('twitterAccounts.covid19nearmeau.accTknSecret')
    });

    try{
        let lastTweetID = "";
        for (const status of thread) {
            console.log(`Tweeting:\n${status}\n`);
            const tweet = await client.post("statuses/update", {
                status: status,
                in_reply_to_status_id: lastTweetID,
                auto_populate_reply_metadata: true
            });
            lastTweetID = tweet.id_str;
        }
    }catch(e){
        console.log(e)
    }
}

module.exports = tweetThread;