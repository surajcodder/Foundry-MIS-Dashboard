sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/m/MessageToast",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/format/DateFormat"
], function(
	Controller,
	MessageToast,
	Filter,
	FilterOperator,
	JSONModel,
	DateFormat
) {
	"use strict";

	return Controller.extend("com.infocusinMIS_Dashboard_2.controller.View1", {

		onInit: function() {
			var oComponent = this.getOwnerComponent();

			this._ensureModel(oComponent, "dtmModel");
			this._ensureModel(oComponent, "combineModel");
			this._ensureModel(oComponent, "dispatchModel");
			this._ensureModel(oComponent, "stockModel");
			this._ensureModel(oComponent, "itemModel");

			this._setModelsOnView();
		},

		_ensureModel: function(oComponent, sName) {
			if (!oComponent.getModel(sName)) {
				oComponent.setModel(new JSONModel([]), sName);
			}
		},

		onExecuteReport: async function() {
			var oDatePicker = this.byId("dpDate");
			var oDate = oDatePicker.getDateValue();

			if (!oDate) {
				MessageToast.show("Please select a date");
				return;
			}

			var oFormatter = DateFormat.getDateInstance({
				pattern: "yyyyMMdd"
			});
			var sDate = oFormatter.format(oDate);

			var oModel = this.getOwnerComponent().getModel();
			oModel.setUseBatch(false);

			var oFilter = new Filter("budat", FilterOperator.EQ, sDate);
			sap.ui.core.BusyIndicator.show(0);

			console.log("--- Report Execution Started for Date: " + sDate + " ---");

			try {
				// Parallelizing backend calls to save time
				const [oDtm, oCombine, oDisp, oStock] = await Promise.all([
					this._readOData(oModel, "/es_dtmset", [oFilter]),
					this._readOData(oModel, "/es_combineset", [oFilter]),
					this._readOData(oModel, "/es_dm_dispset", [oFilter]),
					this._readOData(oModel, "/es_stockset", [oFilter])
				]);

				console.log("Raw DTM Data:", oDtm.results);
				console.log("Raw Combine Data:", oCombine.results);
				console.log("Raw Dispatch Data:", oDisp.results);
				console.log("Raw Stock Data:", oStock.results);

				// Optimized mapping for Sl No
				const aDtmResults = (oDtm.results || []).map((item, index) => ({
					...item,
					sl_no: (index + 1).toString()
				}));

				console.log("Transformed DTM with Sl No:", aDtmResults);

				// Set Data to Models
				this.getOwnerComponent().getModel("dtmModel").setData(aDtmResults);
				this.getOwnerComponent().getModel("combineModel").setData(oCombine.results || []);
				this.getOwnerComponent().getModel("dispatchModel").setData(oDisp.results || []);
				this.getOwnerComponent().getModel("stockModel").setData(oStock.results || []);

				this._buildItemModel();

				console.log("Final itemModel Data:", this.getOwnerComponent().getModel("itemModel").getData());

				this._setModelsOnView();
				this._refreshCharts();

				MessageToast.show("Data Loaded Successfully");

			} catch (oError) {
				console.error("Fetch Error Detail:", oError);
				MessageToast.show("Error loading data");
			} finally {
				console.log("--- Report Execution Finished ---");
				sap.ui.core.BusyIndicator.hide();
			}
		},

		_readOData: function(oModel, sPath, aFilters) {
			return new Promise(function(resolve, reject) {
				oModel.read(sPath, {
					filters: aFilters,
					success: resolve,
					error: reject
				});
			});
		},

		onToggleView: function(oEvent) {
			var sKey = oEvent.getParameter("key");

			var oTable = this.byId("plantTable");
			var oChart = this.byId("plantChart");
			var oViz = this.byId("plantViz");

			if (sKey === "CHART") {
				oTable.setVisible(false);
				oChart.setVisible(true);

				setTimeout(function() {
					if (oViz) {
						oViz.invalidate();
						oViz.rerender();
					}
				}, 200);

			} else {
				oTable.setVisible(true);
				oChart.setVisible(false);
			}
		},

		_setModelsOnView: function() {
			var oView = this.getView();
			var oComp = this.getOwnerComponent();

			oView.setModel(oComp.getModel("dtmModel"), "dtmModel");
			oView.setModel(oComp.getModel("combineModel"), "combineModel");
			oView.setModel(oComp.getModel("dispatchModel"), "dispatchModel");
			oView.setModel(oComp.getModel("stockModel"), "stockModel");
			oView.setModel(oComp.getModel("itemModel"), "itemModel");

			// ✅ only these two
			this._setTableRows("misTable", "dtmModel");
			this._setTableRows("itemTable", "itemModel");
		},

		_setTableRows: function(sTableId, sModelName) {
			var oTable = this.byId(sTableId);
			if (!oTable) {
				return;
			}

			var oModel = this.getOwnerComponent().getModel(sModelName);

			setTimeout(function() {
				var aData = (oModel && oModel.getData()) || [];
				oTable.setVisibleRowCount(aData.length); // 0 shows "No data"
				oTable.setFirstVisibleRow(0);
				oTable.invalidate();
			}, 0);
		},

		_refreshCharts: function() {
			var aVizIds = ["plantViz", "combineViz", "dispatchViz", "stockViz"];
			var that = this;

			aVizIds.forEach(function(sId) {
				var oViz = that.byId(sId);
				if (oViz) {
					oViz.setVizProperties({
						plotArea: {
							dataLabel: {
								visible: true
							}
						},
						legend: {
							visible: true
						},
						title: {
							visible: false
						}
					});
					oViz.invalidate();
					oViz.rerender();
				}
			});
		},

		formatFloat: function(sValue) {
			if (!sValue) {
				return 0;
			}
			var sPart = sValue.toString().split("/")[0];
			var sClean = sPart.replace(/[^0-9.-]/g, "");
			var fValue = parseFloat(sClean);
			return isNaN(fValue) ? 0 : fValue;
		},

		_normalizeKey: function(s) {
			if (!s) {
				return "";
			}
			return s.toUpperCase()
				.replace(/[_\s-]/g, "")
				.replace(/ASSM|ASSLY|ASSY|ASSEMBLY/g, "") // remove suffixes from combine
				.replace(/DGEAR/g, "DRAFTGEAR"); // optional normalize
		},

		_buildItemModel: function() {
			var that = this;
			var oComp = this.getOwnerComponent();

			// Get raw data from models
			var aCombine = oComp.getModel("combineModel").getData() || [];
			var aDisp = oComp.getModel("dispatchModel").getData() || [];
			var aStock = oComp.getModel("stockModel").getData() || [];

			console.log("Building Item Model. Combine Count:", aCombine.length, "Dispatch Count:", aDisp.length);

			// Build a map of Combine data by normalized key for quick lookup
			var mCombine = {};
			aCombine.forEach(function(c) {
				var k = that._normalizeKey(c.category);
				mCombine[k] = c;
			});

			var aOut = [];

			// Loop through DISPATCH results so all 3 items (BOGIE, COUPLER, DGEAR) appear
			aDisp.forEach(function(d, idx) {
				var k = that._normalizeKey(d.category);
				var c = mCombine[k] || {}; // Find matching combine data if it exists

				aOut.push({
					sl_no: (idx + 1).toString(),
					item_name: (d.category || "").replace(/_/g, " "), // Use category from Dispatch
					target: c.t_menge || "0.000",
					actual_on_date: c.d_act || "0.000",
					actual_till_date: c.m_act || "0.000",

					dm_item: (d.category || "").replace(/_/g, " "),
					dm_actual_on_date: d.dm_daily || "0.000",
					dm_actual_till_date: d.dm_month || "0.000",
					disp_actual_on_date: d.dis_daily || "0.000",
					disp_actual_till_date: d.dis_month || "0.000",

					isSummary: false
				});
			});

			// Add Stock/Summary rows at the end
			aStock.forEach(function(s) {
				aOut.push({
					sl_no: "",
					item_name: s.parameter || "",
					target: s.menge || "0.000",
					actual_on_date: "",
					actual_till_date: "",
					dm_item: "",
					dm_actual_on_date: "",
					dm_actual_till_date: "",
					disp_actual_on_date: "",
					disp_actual_till_date: "",
					isSummary: true
				});
			});

			oComp.getModel("itemModel").setData(aOut);
			console.log("Final Item Model Count:", aOut.length);
		}

	});
});