// this script is used to get the access tokens for different users
const Twitter = require('twitter-lite');
const config = require('config');

const client = new Twitter({
    consumer_key: config.get('twitter.apiKey'),
    consumer_secret: config.get('twitter.apiSecretKey')
});

// part 1
client
  .getRequestToken("http://localhost")
  .then(res =>
    console.log({
        auth: `https://api.twitter.com/oauth/authenticate?oauth_token=${res.oauth_token}`,
        reqTkn: res.oauth_token,
        reqTknSecret: res.oauth_token_secret
    })
  )
  .catch(console.error);

// part 2
client
  .getAccessToken({
    oauth_verifier: '',
    oauth_token: ''
  })
  .then(res =>
    console.log({
      accTkn: res.oauth_token,
      accTknSecret: res.oauth_token_secret,
      userId: res.user_id,
      screenName: res.screen_name
    })
  )
  .catch(console.error);
