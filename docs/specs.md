I want to make a market simulation game to make people understand the stock market better. Ask me questions using AskUserQuestion.

# Market Simulation
In Market simulation game user will make a portfolio of stocks and will be able to buy and sell stocks. The game will simulate the stock market and will update the stock prices based on market conditions. The user will be able to see the performance of their portfolio and compare it with other users.

## Features
- The game will start with an initial investment of Rs 10,000,000.00 INR (1 CR).
- The user will be able to buy and sell stocks and mutual funds in indian stock market.
- User can not short sell stocks or mutual funds
- Stocks will be based on nifty 500 stock universe as mentioned in ind_nifty500list.csv file
- User will be taken a random time period but don't tell the user about the time period. The user will have to make investment decisions based on the market conditions
- The game will simulate the stock market for a random time period and will update the stock prices based on market conditions. 
- When user clicks on next, the stock prices will be updated for next  month.
- Update the portfolio performance based on the new stock prices and show the user the performance of their portfolio.
- At the end of the game, show the user the performance of their portfolio and compare it with other users.
- Reveal the timeperiod at the end of the game and show the user how their portfolio performed during that time period.
- Once game starts it can stop in between 1 year and 10 years. The user will not know when the game will end. The user will have to make investment decisions based on the market conditions and the time period of the game.
- Show user the earnings from yahoo finance, but don't show the time period of the game until the end of the game. The user should make investment decisions based on the market conditions and not based on the time period of the game.


## Technical Specifications
- The game will be developed using Python and will use the FastAPI framework for the web application.
- The game will use a database to store user information, portfolio information, and stock price information. We can use SQLite for simplicity.
- Use uv for running the FastAPI application.
- The game will use a frontend framework like React / vite for the user interface.
- The game will use a stock price API to get the stock prices. We can use Yahoo Finance API for getting the stock prices.
- The game will use a random number generator to simulate the stock market and to determine the time period of the game.
- Keep the time period of the game after 2010 .
- for mutual funds only show funds with growth and direct plan options. Use data from https://api.mfapi.in/mf to get all the mutual funds and filter the funds based on the criteria mentioned above.
- Cache the mutual fund list master data to avoid making API calls every time the user wants to see the mutual fund list. We can use a simple caching mechanism like a dictionary to store the mutual fund list master data and update it periodically (e.g., once a day) to ensure that we have the latest data.
- based on selected mutual fund call the api https://api.mfapi.in/mf/100122 to get the historical NAV data for that mutual fund and use it to simulate the mutual fund price movements in the game.

## User Interface
Make the UI professional and user friendly. The user should be able to easily navigate through the game and make investment decisions based on the market conditions. The user should also be able to see the performance of their portfolio and compare it with other users.
- User should able to run the game on their local machine by following the instructions in the README file.
- UI should be mobile responsive and should work on all devices.

## Important 
Never reveal the time period of the game to the user until the end of the game. The user should make investment decisions based on the market conditions and not based on the time period of the game.









