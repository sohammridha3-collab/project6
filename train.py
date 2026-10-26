import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.preprocessing import OneHotEncoder
from sklearn.calibration import CalibratedClassifierCV
from xgboost import XGBClassifier
import joblib

print("Loading dataset...")
df = pd.read_csv("credit_risk_dataset.csv")

# Data cleaning as per notebook
df.drop_duplicates(inplace=True)
df = df[(df['person_age'] >= 18) & (df['person_age'] <= 100)]
df = df[df['person_emp_length'] <= df['person_age']]
df = df[df['person_emp_length'] <= 60]
df = df[df['loan_amnt'] > 0]

X = df.drop('loan_status', axis=1)
y = df['loan_status']

X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42, stratify=y
)

numeric_cols = [
    'person_age', 'person_income', 'person_emp_length', 'loan_amnt',
    'loan_int_rate', 'loan_percent_income', 'cb_person_cred_hist_length'
]
categorical_cols = [
    'person_home_ownership', 'loan_intent', 'loan_grade', 'cb_person_default_on_file'
]

neg, pos = np.bincount(y_train)
scale_weights = neg / pos

preprocessor_xg = ColumnTransformer(
    transformers=[
        ('num', Pipeline([
            ('imputer', SimpleImputer(strategy='median'))
        ]), numeric_cols),
        ('cat', Pipeline([
            ('imputer', SimpleImputer(strategy="constant", fill_value="Missing")),
            ('onehot', OneHotEncoder(handle_unknown='ignore'))
        ]), categorical_cols)
    ]
)

best_classifier = XGBClassifier(
    colsample_bytree=0.9374256499933686,
    gamma=2.391359792655321,
    learning_rate=0.1316690691287814,
    max_depth=5,
    min_child_weight=7,
    n_estimators=366,
    subsample=0.845303589935636,
    scale_pos_weight=scale_weights,
    random_state=42,
    eval_metric="logloss"
)

xg_pipeline = Pipeline([
    ('preprocessor', preprocessor_xg),
    ('classifier', best_classifier)
])

print("Fitting calibrated classifier (5-fold CV)...")
calibrated_model = CalibratedClassifierCV(
    xg_pipeline,
    method="sigmoid",
    cv=5
)
calibrated_model.fit(X_train, y_train)

print("Saving credit_risk_model.pkl...")
joblib.dump(calibrated_model, "credit_risk_model.pkl")

print("Testing reload...")
loaded_model = joblib.load("credit_risk_model.pkl")
sample_pred = loaded_model.predict_proba(X_test.iloc[:1])[:, 1][0]
print(f"Reload successful! Sample probability: {sample_pred:.4f}")
