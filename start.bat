@echo off
echo Loading environment variables...
:: Load environment variables from .env file
for /f "tokens=1,* delims==" %%a in (.env) do (
    if not "%%a" == "" (
        if not "%%a:~0,1%" == "#" (
            set "%%a=%%b"
        )
    )
)

echo Installing dependencies...
call npm install
python -m venv venv
call venv\Scripts\activate.bat
call pip install -r requirements.txt

echo Setting up Flask environment...
set FLASK_ENV=production
set FLASK_APP=dashboard.py

echo Starting server on port %PORT%...
python -m flask run --host=0.0.0.0 --port=%PORT%